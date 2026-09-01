// Media grid for a room: all images/videos from loaded history, newest first.
// Older media is loaded automatically — the gallery back-paginates until the
// grid fills its scroll area and then lazily, as the user scrolls toward the
// bottom — so nothing "disappears" after a reload restores only the recent
// sync window. Opens a lightbox on click.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixAccount } from "../core/account";
import type { MediaItem } from "../core/types";
import { encryptedMediaUrl, mediaUrl } from "../core/media";
import { useRoomVersion } from "./hooks";
import { formatSize } from "./format";
import { IconAlert, IconChat, IconFile, IconDownload, IconX } from "./components/Icons";

// Cap how many pages we back-paginate automatically per room/tab, so a room
// with little media doesn't scan its entire history unprompted. Beyond this,
// the "Load older" button takes over.
const MAX_AUTO_PAGES = 8;

function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") return el;
  }
  return null;
}

export function MediaGallery({ account, roomId }: { account: MatrixAccount; roomId: string }) {
  useRoomVersion(account, roomId);
  const [tab, setTab] = useState<"media" | "files">("media");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [canPaginate, setCanPaginate] = useState(true);
  const [lightbox, setLightbox] = useState<MediaItem | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const autoPages = useRef(0);

  let handle;
  try {
    handle = account.room(roomId);
  } catch {
    return null;
  }

  const media = handle.media(tab === "media" ? ["image", "video"] : ["file"]);

  const loadOlder = async (): Promise<void> => {
    if (loadingRef.current) return;
    if (!handle.canPaginateBack()) {
      setCanPaginate(false);
      return;
    }
    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const more = await handle.paginateBack(60);
      setCanPaginate(more && handle.canPaginateBack());
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  };

  // Reset the auto-fill budget when the room or tab changes.
  useEffect(() => {
    autoPages.current = 0;
    setCanPaginate(handle.canPaginateBack());
  }, [handle, tab]);

  // Auto-fill: while the content is too short to scroll (e.g. right after a
  // reload), keep pulling older pages until the scroll area overflows, the
  // room start is reached, or the per-room budget is spent. Runs after every
  // render; cheap and guarded.
  useEffect(() => {
    const sp = scrollParent(rootRef.current);
    if (!sp || loadingOlder || !canPaginate) return;
    if (autoPages.current >= MAX_AUTO_PAGES) return;
    if (sp.scrollHeight <= sp.clientHeight + 40) {
      autoPages.current += 1;
      void loadOlder();
    }
  });

  // Lazy-load more as the user scrolls toward the bottom of the pane.
  useEffect(() => {
    const sp = scrollParent(rootRef.current);
    if (!sp) return;
    const onScroll = () => {
      if (sp.scrollHeight - sp.scrollTop - sp.clientHeight < 320) void loadOlder();
    };
    sp.addEventListener("scroll", onScroll, { passive: true });
    return () => sp.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  return (
    <div className="media-gallery" ref={rootRef}>
      <div className="server-suggestions" role="tablist" aria-label="Media type" style={{ padding: "0 var(--sp-2)" }}>
        <button role="tab" aria-selected={tab === "media"} className={`chip${tab === "media" ? " selected" : ""}`} onClick={() => setTab("media")}>
          Photos & videos
        </button>
        <button role="tab" aria-selected={tab === "files"} className={`chip${tab === "files" ? " selected" : ""}`} onClick={() => setTab("files")}>
          Files
        </button>
      </div>

      {media.length === 0 && !loadingOlder && !canPaginate ? (
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

      {loadingOlder && (
        <div className="state-line" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", padding: "var(--sp-3)" }}>
          <span className="spinner" /> Loading older…
        </div>
      )}
      {!loadingOlder && canPaginate && (
        <button className="btn secondary small" style={{ margin: "var(--sp-3)" }} onClick={loadOlder}>
          Load older
        </button>
      )}

      {lightbox && <MediaLightbox item={lightbox} account={account} onClose={() => setLightbox(null)} />}
    </div>
  );
}

interface MediaSrc {
  src?: string;
  error: boolean;
  retry: () => void;
}

function useThumb(account: MatrixAccount, item: MediaItem): MediaSrc {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(false);
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setError(false);
    if (!account.client) return;
    const thumbFile = item.thumbFile ?? (item.kind === "image" ? item.file : undefined);
    const thumbMxc = item.thumbMxc ?? (item.kind === "image" ? item.mxc : undefined);
    const p = thumbFile
      ? encryptedMediaUrl(account.client, thumbFile, item.mime)
      : thumbMxc
        ? mediaUrl(account.client, thumbMxc, { w: 300, h: 300 })
        : undefined;
    if (!p) return;
    p.then((u) => alive && setSrc(u)).catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [account, item, attempt]);
  return { src, error, retry };
}

function MediaThumb({ item, account, onOpen }: { item: MediaItem; account: MatrixAccount; onOpen: () => void }) {
  const { src, error, retry } = useThumb(account, item);
  if (error) {
    return (
      <button
        className="media-cell media-error"
        onClick={(e) => {
          e.stopPropagation();
          retry();
        }}
        aria-label="Couldn't load media — tap to retry"
      >
        <IconAlert size={18} />
        <span>Retry</span>
      </button>
    );
  }
  return (
    <button className="media-cell" onClick={onOpen} aria-label={item.text || item.kind} title={`${item.senderName} · ${new Date(item.ts).toLocaleDateString()}`}>
      {src ? <img src={src} alt={item.text} loading="lazy" /> : <span className="skeleton" style={{ width: "100%", height: "100%" }} />}
      {item.kind === "video" && <span className="media-play">▶</span>}
    </button>
  );
}

function FileRow({ item, account }: { item: MediaItem; account: MatrixAccount }) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setError(false);
    if (!account.client) return;
    const p = item.file ? encryptedMediaUrl(account.client, item.file, item.mime) : mediaUrl(account.client, item.mxc);
    p?.then((u) => alive && setSrc(u)).catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [account, item, attempt]);
  if (error) {
    return (
      <button
        className="media-error"
        onClick={() => {
          setError(false);
          setAttempt((n) => n + 1);
        }}
        style={{ borderBottom: "1px solid var(--border)" }}
        aria-label={`Couldn't load ${item.text || "file"} — tap to retry`}
      >
        <IconAlert size={18} />
        <span>Couldn't load {item.text || "file"} — tap to retry</span>
      </button>
    );
  }
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
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // onClose churns as the room syncs; read it via ref so the focus effect runs
  // once and doesn't re-grab focus mid-view.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setError(false);
    if (!account.client) return;
    const p = item.file ? encryptedMediaUrl(account.client, item.file, item.mime) : mediaUrl(account.client, item.mxc);
    p?.then((u) => alive && setSrc(u)).catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [account, item, attempt]);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === "Tab") {
        const el = ref.current;
        if (!el) return;
        const items = [...el.querySelectorAll<HTMLElement>("button, video, a[href], [tabindex]")].filter(
          (f) => !f.hasAttribute("disabled"),
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.text || "Media"} ref={ref}>
      <button
        ref={closeRef}
        type="button"
        className="lightbox-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close preview"
      >
        <IconX size={22} />
      </button>
      {error ? (
        <button
          type="button"
          className="media-error lightbox-error"
          onClick={(e) => {
            e.stopPropagation();
            setError(false);
            setAttempt((n) => n + 1);
          }}
        >
          <IconAlert size={20} />
          <span>Couldn't load — tap to retry</span>
        </button>
      ) : !src ? (
        <span className="spinner" />
      ) : item.kind === "video" ? (
        <video src={src} controls autoPlay onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={src} alt={item.text} />
      )}
    </div>
  );
}
