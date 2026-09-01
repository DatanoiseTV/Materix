// Thread panel: the root message followed by its replies, using the same bubble
// rendering as the main timeline, plus an inline thread composer.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MatrixAccount } from "../core/account";
import type { RoomHandle } from "../core/roomHandle";
import type { TimelineItem } from "../core/types";
import { useRoomVersion } from "./hooks";
import { TimelineRow } from "./Timeline";
import { ContextMenu, type MenuState } from "./components/ContextMenu";
import { EmojiPicker } from "./components/EmojiPicker";
import { IconEdit, IconReply, IconSend, IconX } from "./components/Icons";
import { useToast } from "./components/Toast";

export interface ThreadMode {
  kind: "reply" | "edit";
  item: TimelineItem;
}

export function ThreadView({
  account,
  handle,
  rootEventId,
  onClose,
}: {
  account: MatrixAccount;
  handle: RoomHandle;
  rootEventId: string;
  onClose: () => void;
}) {
  const version = useRoomVersion(account, handle.roomId);
  const [mode, setMode] = useState<ThreadMode | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; eventId: string } | null>(null);
  const { showError } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = handle.threadItems(rootEventId);

  // Follow the bottom as replies arrive.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [version, rootEventId]);

  return (
    <aside className="thread-pane" aria-label="Thread">
      <div className="details-header">
        <span>Thread</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close thread">
          <IconX size={18} />
        </button>
      </div>
      <div className="thread-body" ref={scrollRef} onClick={onLinkOpen}>
        {items.map((item) => (
          <TimelineRow
            key={item.id}
            item={item}
            account={account}
            handle={handle}
            onReply={(it) => setMode({ kind: "reply", item: it })}
            onEdit={(it) => setMode({ kind: "edit", item: it })}
            onZoom={setLightbox}
            onUserMenu={setMenu}
            onEmojiPicker={setPicker}
          />
        ))}
        {items.length === 0 && <div className="state-line">This thread has no messages yet.</div>}
      </div>
      <ThreadComposer
        handle={handle}
        rootEventId={rootEventId}
        mode={mode}
        onClearMode={() => setMode(null)}
      />
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview">
          <img src={lightbox} alt="" />
        </div>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {picker && (
        <EmojiPicker
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(emoji) => handle.react(picker.eventId, emoji).catch(showError)}
        />
      )}
    </aside>
  );
}

// Links inside thread bubbles open in a new tab; keep it simple (the main
// timeline's safety prompt is not duplicated here).
function onLinkOpen(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  const href = a.getAttribute("href") ?? "";
  if (!/^https?:/i.test(href)) return;
  e.preventDefault();
  window.open(href, "_blank", "noopener,noreferrer");
}

export function ThreadComposer({
  handle,
  rootEventId,
  mode,
  onClearMode,
}: {
  handle: RoomHandle;
  rootEventId: string;
  mode: ThreadMode | null;
  onClearMode: () => void;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { showError } = useToast();

  useEffect(() => {
    setText(mode?.kind === "edit" ? (mode.item.body?.msgtype === "m.text" ? mode.item.body.text : "") : "");
    taRef.current?.focus();
  }, [mode]);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.3)}px`;
  };

  async function send() {
    const value = text.trim();
    if (!value) return;
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
    const current = mode;
    onClearMode();
    try {
      if (current?.kind === "edit") {
        // Mirror Composer.send(): never silently fall through to a new reply if
        // the edit target lost its event id — that would re-post the edit as a
        // fresh message.
        if (!current.item.eventId) throw new Error("original message has no event id");
        await handle.edit(current.item.eventId, value);
      } else {
        await handle.sendThreadReply(rootEventId, value);
      }
    } catch (e) {
      showError(e);
      setText(value);
    }
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        {mode && (
          <div className="composer-reply">
            {mode.kind === "reply" ? <IconReply size={14} /> : <IconEdit size={14} />}
            <span className="composer-reply-text">
              {mode.kind === "reply" ? (
                <>
                  Replying to <strong>{mode.item.sender.name}</strong>: {mode.item.body?.text?.slice(0, 80)}
                </>
              ) : (
                "Editing message"
              )}
            </span>
            <button className="icon-btn" onClick={onClearMode} aria-label="Cancel" style={{ width: 26, height: 26 }}>
              <IconX size={14} />
            </button>
          </div>
        )}
        <div className="composer-main">
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Reply in thread"
            value={text}
            aria-label="Reply in thread"
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape" && mode) onClearMode();
            }}
          />
          {text.trim() && (
            <button className="send-btn" onClick={() => void send()} aria-label="Send reply">
              <IconSend size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
