// Middle column: header + timeline + typing + composer for the selected room.

import { useMemo, useState } from "react";
import { accountManager } from "../core/manager";
import type { TimelineItem } from "../core/types";
import { useRoomVersion, useRoomsVersion } from "./hooks";
import type { Selection } from "./RoomList";
import { Timeline } from "./Timeline";
import { Composer, type ComposeMode } from "./Composer";
import { Avatar } from "./components/Avatar";
import { IconBack, IconChat, IconInfo, IconLock } from "./components/Icons";
import { typingText } from "./format";
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
  const { showError } = useToast();

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

  return (
    <main className="chat-pane">
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
        <button className="icon-btn" onClick={onToggleDetails} title="Room info" aria-label="Room info">
          <IconInfo size={20} />
        </button>
      </header>

      <LiveBeacons account={account} roomId={selection.roomId} />
      <Timeline
        account={account}
        handle={handle}
        onReply={(item: TimelineItem) => setMode({ kind: "reply", item })}
        onEdit={(item: TimelineItem) => setMode({ kind: "edit", item })}
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
        />
      )}
    </main>
  );
}
