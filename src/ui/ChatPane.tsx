// Middle column: header + timeline + typing + composer for the selected room.

import { useMemo, useRef, useState } from "react";
import { accountManager } from "../core/manager";
import type { RoomHandle } from "../core/roomHandle";
import type { TimelineItem } from "../core/types";
import { useRoomVersion, useRoomsVersion } from "./hooks";
import type { Selection } from "./RoomList";
import { Timeline } from "./Timeline";
import { ThreadView } from "./ThreadView";
import { Composer, type ComposeMode } from "./Composer";
import { Avatar } from "./components/Avatar";
import {
  IconBack,
  IconChat,
  IconChevronDown,
  IconChevronUp,
  IconInfo,
  IconLock,
  IconPaperclip,
  IconSearch,
  IconX,
} from "./components/Icons";
import { formatTime, typingText } from "./format";
import { useToast } from "./components/Toast";
import { useEffect } from "react";
import { LiveBeacons } from "./LiveBeacons";

export function ChatPane({
  selection,
  onBack,
  onToggleDetails,
  showBackButton,
}: {
  selection: Selection | null;
  onBack: () => void;
  onToggleDetails: () => void;
  showBackButton: boolean;
}) {
  useRoomsVersion();
  const account = accountManager.tryAccount(selection?.accountKey ?? null);
  useRoomVersion(account, selection?.roomId ?? null);
  const [mode, setMode] = useState<ComposeMode | null>(null);
  const [threadRoot, setThreadRoot] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const dropFilesRef = useRef<((files: FileList | File[]) => void) | null>(null);
  const scrollToEventRef = useRef<((eventId: string) => void) | null>(null);
  const { showError } = useToast();

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragOver(false);
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files.length) dropFilesRef.current?.(e.dataTransfer.files);
    },
  };

  const handle = useMemo(() => {
    if (!account || !selection) return null;
    try {
      const h = account.room(selection.roomId);
      // Freeze the unread marker at open, so it survives the read receipt.
      h.snapshotReadMarker();
      return h;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, selection?.roomId]);

  // Close the thread panel and search bar when switching rooms.
  useEffect(() => {
    setThreadRoot(null);
    setSearchOpen(false);
  }, [selection?.roomId]);

  // Mark read when the room is open and messages arrive.
  const version = useRoomVersion(account, selection?.roomId ?? null);
  useEffect(() => {
    if (!handle) return;
    const t = setTimeout(() => handle.markRead().catch(() => undefined), 600);
    return () => clearTimeout(t);
  }, [handle, version]);

  if (!selection || !account || !handle) {
    return (
      <main className="chat-pane">
        <div className="empty-state">
          <div className="empty-glyph">
            <IconChat size={30} />
          </div>
          <h2>Welcome to Materix</h2>
          <p>Select a chat on the left, or start a new conversation.</p>
        </div>
      </main>
    );
  }

  const summary = account.rooms().find((r) => r.roomId === selection.roomId);
  const details = handle.details();
  const typing = typingText(handle.typingNames());

  const dropEnabled = !summary?.isInvite;

  return (
    <main className="chat-pane" {...(dropEnabled ? dragHandlers : {})}>
      {dragOver && dropEnabled && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-inner">
            <IconPaperclip size={32} />
            <div className="drop-overlay-title">Drop to send</div>
            <div className="drop-overlay-sub">Images open the editor; other files upload directly</div>
          </div>
        </div>
      )}
      <header className="chat-header">
        {showBackButton && (
          <button className="icon-btn" onClick={onBack} aria-label="Back to chat list">
            <IconBack size={20} />
          </button>
        )}
        <Avatar account={account} mxc={summary?.avatarUrl} name={details.name} id={details.roomId} size={40} />
        <div className="chat-header-info">
          <div className="chat-header-name">
            {details.name}
            {details.isEncrypted && (
              <span className="enc-lock" title="End-to-end encrypted">
                <IconLock size={14} />
              </span>
            )}
          </div>
          <div className="chat-header-sub">
            {details.isDirect && summary?.isDirect
              ? account.info().userId === details.name
                ? ""
                : "Direct message"
              : `${details.memberCount} member${details.memberCount === 1 ? "" : "s"}`}
            {details.topic ? ` · ${details.topic}` : ""}
          </div>
        </div>
        <button
          className={`icon-btn${searchOpen ? " active" : ""}`}
          onClick={() => setSearchOpen((v) => !v)}
          title="Search messages"
          aria-label="Search messages"
          aria-pressed={searchOpen}
        >
          <IconSearch size={20} />
        </button>
        <button className="icon-btn" onClick={onToggleDetails} title="Room info" aria-label="Room info">
          <IconInfo size={20} />
        </button>
      </header>

      {searchOpen && (
        <RoomSearch
          handle={handle}
          version={version}
          onClose={() => setSearchOpen(false)}
          onJump={(eventId) => scrollToEventRef.current?.(eventId)}
        />
      )}

      <LiveBeacons account={account} roomId={selection.roomId} />
      <Timeline
        account={account}
        handle={handle}
        onReply={(item: TimelineItem) => setMode({ kind: "reply", item })}
        onEdit={(item: TimelineItem) => setMode({ kind: "edit", item })}
        onOpenThread={setThreadRoot}
        scrollToRef={scrollToEventRef}
      />
      <div className="typing-bar" aria-live="polite">
        {typing}
      </div>
      {summary?.isInvite ? (
        <div className="composer-wrap">
          <div className="composer" style={{ flexDirection: "row", padding: "var(--sp-3)", gap: "var(--sp-2)" }}>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={() => account.acceptInvite(selection.roomId).catch(showError)}
            >
              Accept invitation
            </button>
            <button
              className="btn secondary"
              style={{ flex: 1 }}
              onClick={() => {
                account.rejectInvite(selection.roomId).catch(showError);
                onBack();
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ) : (
        <Composer
          handle={handle}
          accountKey={selection.accountKey}
          mode={mode}
          onClearMode={() => setMode(null)}
          dropFilesRef={dropFilesRef}
        />
      )}
      {threadRoot && (
        <ThreadView account={account} handle={handle} rootEventId={threadRoot} onClose={() => setThreadRoot(null)} />
      )}
    </main>
  );
}

/**
 * In-room search over already-loaded history (see RoomHandle.searchMessages).
 * Local-only: it never calls the homeserver search API, so it matches only the
 * messages currently in the timeline. Users can pull older pages to widen it.
 */
function RoomSearch({
  handle,
  version,
  onClose,
  onJump,
}: {
  handle: RoomHandle;
  version: number;
  onClose: () => void;
  onJump: (eventId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { showError } = useToast();

  // `version` bumps when the timeline changes (e.g. after pulling older pages),
  // so results re-derive against the freshly loaded events.
  const results = useMemo(() => handle.searchMessages(query), [handle, query, version]);
  const canPaginate = handle.canPaginateBack();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset the cursor whenever the query changes.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const jump = (idx: number) => {
    if (!results.length) return;
    const i = ((idx % results.length) + results.length) % results.length;
    setActive(i);
    onJump(results[i].eventId);
  };

  const loadOlder = () => {
    if (loadingOlder || !canPaginate) return;
    setLoadingOlder(true);
    // Pull a few pages so the searchable window widens noticeably in one tap.
    (async () => {
      for (let n = 0; n < 3 && handle.canPaginateBack(); n++) await handle.paginateBack();
    })()
      .catch(showError)
      .finally(() => setLoadingOlder(false));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      jump(active + (e.shiftKey ? -1 : 1));
    }
  };

  const count = results.length;
  return (
    <div className="room-search" onKeyDown={onKeyDown}>
      <div className="room-search-bar">
        <div className="room-search-field">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search loaded messages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search messages in this room"
          />
        </div>
        <span className="room-search-count" aria-live="polite">
          {query.trim() ? (count ? `${active + 1}/${count}` : "0") : ""}
        </span>
        <button
          className="icon-btn"
          onClick={() => jump(active - 1)}
          disabled={!count}
          title="Previous match"
          aria-label="Previous match"
        >
          <IconChevronUp size={18} />
        </button>
        <button
          className="icon-btn"
          onClick={() => jump(active + 1)}
          disabled={!count}
          title="Next match"
          aria-label="Next match"
        >
          <IconChevronDown size={18} />
        </button>
        <button className="icon-btn" onClick={onClose} title="Close search" aria-label="Close search">
          <IconX size={18} />
        </button>
      </div>
      {query.trim() && (
        <div className="room-search-results" role="listbox" aria-label="Search results">
          {results.map((hit, i) => (
            <button
              key={hit.eventId}
              className={`room-search-result${i === active ? " active" : ""}`}
              role="option"
              aria-selected={i === active}
              onClick={() => jump(i)}
            >
              <span className="room-search-result-meta">
                <span className="room-search-result-sender">{hit.senderName}</span>
                <span className="room-search-result-time">{formatTime(hit.ts)}</span>
              </span>
              <span className="room-search-result-snippet">
                <Emphasized text={hit.snippet} term={query.trim()} />
              </span>
            </button>
          ))}
          {!count && (
            <div className="room-search-empty">
              No matches in loaded history.
              {canPaginate && (
                <>
                  {" "}
                  <button className="room-search-more" onClick={loadOlder} disabled={loadingOlder}>
                    {loadingOlder ? "Loading…" : "Search older messages"}
                  </button>
                </>
              )}
            </div>
          )}
          {count > 0 && canPaginate && (
            <button className="room-search-more" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? "Loading older messages…" : "Search older messages"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Render `text` with case-insensitive occurrences of `term` wrapped in <mark>. */
function Emphasized({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark key={k++}>{text.slice(at, at + needle.length)}</mark>);
    i = at + needle.length;
  }
  return <>{out}</>;
}
