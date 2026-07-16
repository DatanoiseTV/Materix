// Media grid for a room: all images/videos from loaded history, newest first,
// with "Load older" to paginate further back. Opens a lightbox on click.

import { useEffect, useState } from "react";
import type { MatrixAccount } from "../core/account";
import type { MediaItem } from "../core/types";
import { encryptedMediaUrl, mediaUrl } from "../core/media";
import { useRoomVersion } from "./hooks";
import { formatSize } from "./format";
import { IconChat, IconFile, IconDownload } from "./components/Icons";

export function MediaGallery({ account, roomId }: { account: MatrixAccount; roomId: string }) {
  useRoomVersion(account, roomId);
  const [tab, setTab] = useState<"media" | "files">("media");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [canPaginate, setCanPaginate] = useState(true);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);

  let handle;
  try {
    handle = account.room(roomId);
  } catch {
    return null;
  }

  const media = handle.media(tab === "media" ? ["image", "video"] : ["file"]);

  useEffect(() => {
    setCanPaginate(handle.canPaginateBack());
  }, [handle, media.length]);

  const loadOlder = async () => {
    setLoadingOlder(true);
    try {
      // Pull several pages so the grid fills with older media, not just a few.
      for (let i = 0; i < 3; i++) {
        const more = await handle.paginateBack(60);
        if (!more) {
          setCanPaginate(false);
          break;
        }
      }
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className="media-gallery">
      <div className="server-suggestions" role="tablist" aria-label="Media type" style={{ padding: "0 var(--sp-2)" }}>
        <button role="tab" aria-selected={tab === "media"} className={`chip${tab === "media" ? " selected" : ""}`} onClick={() => setTab("media")}>
          Photos & videos
        </button>
        <button role="tab" aria-selected={tab === "files"} className={`chip${tab === "files" ? " selected" : ""}`} onClick={() => setTab("files")}>
          Files
        </button>
      </div>

      {media.length === 0 ? (
        <div className="empty-state" style={{ padding: "var(--sp-5)" }}>
          <div className="empty-glyph">
            <IconChat size={26} />
          </div>
          <p>No {tab === "media" ? "photos or videos" : "files"} yet.</p>
        </div>
      ) : tab === "media" ? (
        <div className="media-grid">
          {media.map((m) => (
            <MediaThumb key={m.eventId} item={m} account={account} onOpen={() => setLightbox(m)} />
          ))}
        </div>
      ) : (
        <div className="media-files">
          {media.map((m) => (
            <FileRow key={m.eventId} item={m} account={account} />
          ))}
        </div>
      )}

      {canPaginate && (
        <button className="btn secondary small" style={{ margin: "var(--sp-3)" }} disabled={loadingOlder} onClick={loadOlder}>
          {loadingOlder ? <span className="spinner" /> : "Load older"}
        </button>
      )}

      {lightbox && <MediaLightbox item={lightbox} account={account} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function useThumb(account: MatrixAccount, item: MediaItem): string | undefined {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    if (!account.client) return;
    const thumbFile = item.thumbFile ?? (item.kind === "image" ? item.file : undefined);
    const thumbMxc = item.thumbMxc ?? (item.kind === "image" ? item.mxc : undefined);
    const p = thumbFile
      ? encryptedMediaUrl(account.client, thumbFile, item.mime)
      : thumbMxc
        ? mediaUrl(account.client, thumbMxc, { w: 300, h: 300 })
        : undefined;
    p?.then((u) => alive && setSrc(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account, item]);
  return src;
}

function MediaThumb({ item, account, onOpen }: { item: MediaItem; account: MatrixAccount; onOpen: () => void }) {
  const src = useThumb(account, item);
  return (
    <button className="media-cell" onClick={onOpen} aria-label={item.text || item.kind} title={`${item.senderName} · ${new Date(item.ts).toLocaleDateString()}`}>
      {src ? <img src={src} alt={item.text} loading="lazy" /> : <span className="skeleton" style={{ width: "100%", height: "100%" }} />}
      {item.kind === "video" && <span className="media-play">▶</span>}
    </button>
  );
}

function FileRow({ item, account }: { item: MediaItem; account: MatrixAccount }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (!account.client) return;
    const p = item.file ? encryptedMediaUrl(account.client, item.file, item.mime) : mediaUrl(account.client, item.mxc);
    p?.then((u) => alive && setSrc(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account, item]);
  return (
    <a className="msg-file" href={src} download={item.text} aria-disabled={!src} style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="msg-file-icon">
        <IconFile size={18} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <div className="msg-file-name">{item.text || "File"}</div>
        <div className="msg-file-size">
          {item.senderName} · {formatSize(item.size)}
        </div>
      </span>
      <IconDownload size={15} />
    </a>
  );
}

function MediaLightbox({ item, account, onClose }: { item: MediaItem; account: MatrixAccount; onClose: () => void }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (!account.client) return;
    const p = item.file ? encryptedMediaUrl(account.client, item.file, item.mime) : mediaUrl(account.client, item.mxc);
    p?.then((u) => alive && setSrc(u)).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [account, item, onClose]);
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={item.text || "Media"}>
      {!src ? (
        <span className="spinner" />
      ) : item.kind === "video" ? (
        <video src={src} controls autoPlay onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={src} alt={item.text} />
      )}
    </div>
  );
}
