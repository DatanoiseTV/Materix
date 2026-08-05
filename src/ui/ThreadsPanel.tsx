// Room-wide thread list: every thread in the room, newest activity first.
// Selecting a row opens the existing per-message ThreadView via onOpenThread.

import { useEffect, useMemo } from "react";
import type { MatrixAccount } from "../core/account";
import type { RoomHandle } from "../core/roomHandle";
import { useRoomVersion } from "./hooks";
import { IconThreads, IconX } from "./components/Icons";
import { formatTime } from "./format";

export function ThreadsPanel({
  account,
  handle,
  onOpenThread,
  onClose,
}: {
  account: MatrixAccount;
  handle: RoomHandle;
  onOpenThread: (rootEventId: string) => void;
  onClose: () => void;
}) {
  // Re-derive the list live as replies land and new threads start.
  const version = useRoomVersion(account, handle.roomId);
  const threads = useMemo(() => handle.threads(), [handle, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="threads-panel" aria-label="Threads">
      <div className="details-header">
        <span>Threads</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close threads">
          <IconX size={18} />
        </button>
      </div>
      {threads.length === 0 ? (
        <div className="threads-panel-empty">
          <div className="threads-panel-empty-glyph">
            <IconThreads size={28} />
          </div>
          <p>No threads yet.</p>
          <p className="threads-panel-empty-sub">
            Reply in a thread from a message to start one.
          </p>
        </div>
      ) : (
        <div className="threads-panel-list" role="list" aria-label="Threads in this room">
          {threads.map((t) => (
            <button
              key={t.rootEventId}
              className="threads-panel-item"
              role="listitem"
              onClick={() => onOpenThread(t.rootEventId)}
            >
              <span className="threads-panel-item-meta">
                <span className="threads-panel-item-sender">{t.rootSenderName}</span>
                <span className="threads-panel-item-time">{formatTime(t.latestTs)}</span>
              </span>
              <span className="threads-panel-item-root">{t.rootPreview}</span>
              <span className="threads-panel-item-foot">
                <span className="threads-panel-item-count">
                  {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
                </span>
                <span className="threads-panel-item-latest">{t.latestPreview}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
