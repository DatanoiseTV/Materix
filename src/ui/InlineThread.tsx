// Inline thread: a thread's replies rendered directly beneath its root message
// in the main timeline (expanded from the "N replies" chip), with an inline
// composer. The root itself is not repeated — it's the row this hangs under.

import { useLayoutEffect, useRef, useState } from "react";
import type { MatrixAccount } from "../core/account";
import type { RoomHandle } from "../core/roomHandle";
import { useRoomVersion } from "./hooks";
import { TimelineRow } from "./Timeline";
import { ThreadComposer, type ThreadMode } from "./ThreadView";
import { ContextMenu, type MenuState } from "./components/ContextMenu";
import { EmojiPicker } from "./components/EmojiPicker";
import { IconChevronUp } from "./components/Icons";
import { useToast } from "./components/Toast";

export function InlineThread({
  account,
  handle,
  rootEventId,
  onCollapse,
}: {
  account: MatrixAccount;
  handle: RoomHandle;
  rootEventId: string;
  onCollapse: () => void;
}) {
  const version = useRoomVersion(account, handle.roomId);
  const [mode, setMode] = useState<ThreadMode | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; eventId: string } | null>(null);
  const { showError } = useToast();
  const bodyRef = useRef<HTMLDivElement>(null);

  // threadItems() yields the root followed by its replies; drop the root since
  // it's already the message this block hangs beneath.
  const replies = handle.threadItems(rootEventId).filter((it) => it.eventId !== rootEventId);

  // Follow the bottom of the reply list as new replies arrive.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [version]);

  return (
    <div className="inline-thread" aria-label="Thread">
      <div className="inline-thread-head">
        <span>
          {replies.length > 0
            ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
            : "Thread"}
        </span>
        <button className="inline-thread-collapse" onClick={onCollapse} aria-label="Collapse thread">
          <IconChevronUp size={13} />
          <span>Collapse</span>
        </button>
      </div>
      <div className="inline-thread-body" ref={bodyRef} onClick={onLinkOpen}>
        {replies.map((item) => (
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
        {replies.length === 0 && <div className="state-line">No replies yet — start the thread.</div>}
      </div>
      <ThreadComposer handle={handle} rootEventId={rootEventId} mode={mode} onClearMode={() => setMode(null)} />
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
    </div>
  );
}

// Links inside inline-thread bubbles open in a new tab (the main timeline's
// safety prompt is not duplicated here).
function onLinkOpen(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  const href = a.getAttribute("href") ?? "";
  if (!/^https?:/i.test(href)) return;
  e.preventDefault();
  window.open(href, "_blank", "noopener,noreferrer");
}
