// Message timeline: scroll management (stick to bottom, load older on top),
// message bubbles, media, reactions, hover actions.

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MatrixAccount } from "../core/account";
import type { RoomHandle } from "../core/roomHandle";
import type { MessageBody, TimelineItem } from "../core/types";
import { encryptedMediaUrl, mediaUrl } from "../core/media";
import { useRoomVersion } from "./hooks";
import { Avatar } from "./components/Avatar";
import { ContextMenu, type MenuItem, type MenuState } from "./components/ContextMenu";
import { EmojiPicker } from "./components/EmojiPicker";
import { AudioPlayer } from "./components/AudioPlayer";
import { buildUserMenu, powerLevelMessage } from "./userMenu";
import {
  IconAlert,
  IconChat,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCopy,
  IconDownload,
  IconEdit,
  IconFile,
  IconForward,
  IconInfo,
  IconLocation,
  IconLock,
  IconPin,
  IconPlay,
  IconPlus,
  IconReply,
  IconSmile,
  IconThreads,
  IconTrash,
  IconX,
} from "./components/Icons";
import { Modal } from "./components/Modal";
import { ForwardDialog } from "./dialogs/ForwardDialog";
import { formatDayDivider, formatDuration, formatSize, formatTime } from "./format";
import { copyText } from "./clipboard";
import { useToast } from "./components/Toast";
import { useConfirm, usePrompt } from "./components/Confirm";
import { isOfflineError } from "../core/errors";
import { assessLink, isTrusted, openExternal, type LinkAssessment } from "./linkSafety";
import { LinkWarning } from "./components/LinkWarning";
import { InlineThread } from "./InlineThread";

// Element-Classic-style quick reactions shown in the long-press action sheet's
// top row; the first few also back the desktop hover bar.
const QUICK_REACTIONS = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"];

// Cap the automatic viewport-fill back-pagination per room open. Without it, a
// room whose loaded window is mostly non-rendered state events never fills the
// viewport and would back-paginate its entire history on open. Mirrors
// MediaGallery's MAX_AUTO_PAGES.
const MAX_AUTOFILL_PAGES = 10;

export function Timeline({
  account,
  handle,
  onReply,
  onEdit,
  scrollToRef,
}: {
  account: MatrixAccount;
  handle: RoomHandle;
  onReply: (item: TimelineItem) => void;
  onEdit: (item: TimelineItem) => void;
  /** Populated with a "scroll to eventId and flash it" callback for the parent
   * (in-room search) to drive. Null-safe if no event matches. */
  scrollToRef?: React.MutableRefObject<((eventId: string) => void) | null>;
}) {
  const version = useRoomVersion(account, handle.roomId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);
  const autoFillPages = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; eventId: string } | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sourceView, setSourceView] = useState<string | null>(null);
  const [forwardId, setForwardId] = useState<string | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<LinkAssessment | null>(null);
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(() => new Set());
  const { showError } = useToast();

  // Toggle a message's inline thread open/closed (from its "N replies" chip or
  // the "Reply in thread" action). Expanding renders the replies + a composer
  // directly beneath the root row.
  const toggleThread = (rootEventId: string) =>
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(rootEventId)) next.delete(rootEventId);
      else next.add(rootEventId);
      return next;
    });

  // Intercept clicks on any message link — open directly if it looks safe or is
  // trusted, otherwise show the warning first.
  const onLinkClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:/i.test(href)) return; // let mailto:, #anchors behave normally
    e.preventDefault();
    const assessment = assessLink(href, a.textContent ?? undefined);
    if (!assessment.suspicious || isTrusted(assessment.host)) openExternal(href);
    else setLinkPrompt(assessment);
  };

  const items = handle.timeline();

  // On room open: jump to the first unread (read marker) when present,
  // otherwise to the bottom.
  useEffect(() => {
    autoFillPages.current = 0; // reset the auto-fill budget for the new room
    const el = scrollRef.current;
    if (!el) return;
    const marker = el.querySelector(".read-marker");
    if (marker) {
      stickToBottom.current = false;
      (marker as HTMLElement).scrollIntoView({ block: "center" });
      // If the marker is near the end anyway, resume bottom-following.
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) stickToBottom.current = true;
    } else {
      stickToBottom.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [handle.roomId]);

  // Keep the view pinned to the bottom on new messages; preserve position
  // when history is prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (prevHeight.current && el.scrollHeight > prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    }
    prevHeight.current = el.scrollHeight;
  }, [version, handle.roomId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200 && !loadingOlder && handle.canPaginateBack()) {
      setLoadingOlder(true);
      prevHeight.current = el.scrollHeight;
      handle
        .paginateBack()
        // Automatic backfill: failing offline is expected and not user-actionable,
        // so don't toast it (a real, non-offline error still surfaces).
        .catch((e) => { if (!isOfflineError(e)) showError(e); })
        .finally(() => setLoadingOlder(false));
    }
  };

  // Auto-fill: if the loaded history is too short to scroll (e.g. right after a
  // reload restores only the recent sync window), pull older pages so history
  // is reachable. Without this, a non-scrollable timeline can never fire the
  // scroll-triggered backfill above. Bounded by the backward pagination token,
  // which is null once the room start is reached.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loadingOlder || !handle.canPaginateBack()) return;
    if (autoFillPages.current >= MAX_AUTOFILL_PAGES) return;
    if (el.scrollHeight <= el.clientHeight + 40) {
      autoFillPages.current += 1;
      setLoadingOlder(true);
      prevHeight.current = el.scrollHeight;
      handle
        .paginateBack()
        // Automatic backfill: failing offline is expected and not user-actionable,
        // so don't toast it (a real, non-offline error still surfaces).
        .catch((e) => { if (!isOfflineError(e)) showError(e); })
        .finally(() => setLoadingOlder(false));
    }
  });

  // Expose a "scroll to event + flash highlight" driver for in-room search.
  // All items are rendered (no virtualization), so a matched event is always in
  // the DOM. Escaping the id keeps event ids with `$`/`:` valid in the selector.
  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!scrollToRef) return;
    scrollToRef.current = (eventId: string) => {
      const el = scrollRef.current;
      if (!el) return;
      const row = el.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`);
      if (!row) return;
      stickToBottom.current = false;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.remove("msg-highlight");
      // Force reflow so re-adding the class restarts the animation.
      void row.offsetWidth;
      row.classList.add("msg-highlight");
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => row.classList.remove("msg-highlight"), 1600);
    };
    return () => {
      scrollToRef.current = null;
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, [scrollToRef]);

  return (
    <>
      <div className="timeline" ref={scrollRef} onScroll={onScroll} tabIndex={0} aria-label="Messages">
        <div className="timeline-inner" onClick={onLinkClick}>
          {loadingOlder && (
            <div className="state-line" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="spinner" /> Loading history…
            </div>
          )}
          {items.map((item) => {
            const threadOpen = !!item.eventId && openThreads.has(item.eventId);
            return (
              <Fragment key={item.id}>
                <TimelineRow
                  item={item}
                  account={account}
                  handle={handle}
                  onReply={onReply}
                  onEdit={onEdit}
                  onZoom={setLightbox}
                  onUserMenu={setMenu}
                  onEmojiPicker={setPicker}
                  onActionSheet={setSheet}
                  onViewSource={(src) => setSourceView(src ?? "Source unavailable — event not in loaded history.")}
                  onForward={setForwardId}
                  onOpenThread={toggleThread}
                  threadOpen={threadOpen}
                />
                {threadOpen && item.eventId && (
                  <InlineThread
                    account={account}
                    handle={handle}
                    rootEventId={item.eventId}
                    onCollapse={() => toggleThread(item.eventId!)}
                  />
                )}
              </Fragment>
            );
          })}
          {items.length === 0 &&
            // While history is still resolving (back-paginating or the recent
            // sync window not yet filled), show a loading state rather than
            // asserting the room is empty; the copy also depends on whether the
            // room is actually encrypted.
            (loadingOlder || handle.canPaginateBack() ? (
              <div className="empty-state">
                <span className="spinner" />
                <p>Loading messages…</p>
              </div>
            ) : (
              (() => {
                const encrypted = handle.details().isEncrypted;
                return (
                  <div className="empty-state">
                    <div className="empty-glyph">{encrypted ? <IconLock size={30} /> : <IconChat size={30} />}</div>
                    <h2>No messages yet</h2>
                    <p>
                      {encrypted
                        ? "Say hello — messages in this encrypted room are only readable by members."
                        : "Say hello — this is the beginning of the conversation."}
                    </p>
                  </div>
                );
              })()
            ))}
        </div>
      </div>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {sheet && <MessageActionSheet sheet={sheet} account={account} onClose={() => setSheet(null)} />}
      {sourceView !== null && (
        <Modal title="Message source" onClose={() => setSourceView(null)} wide>
          <pre className="msg-source">{sourceView}</pre>
        </Modal>
      )}
      {picker && (
        <EmojiPicker
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(emoji) => handle.react(picker.eventId, emoji).catch(showError)}
        />
      )}
      {linkPrompt && <LinkWarning assessment={linkPrompt} onClose={() => setLinkPrompt(null)} />}
      {forwardId && <ForwardDialog source={handle} eventId={forwardId} onClose={() => setForwardId(null)} />}
    </>
  );
}

// Accessible full-screen image preview: Escape to close, focus moves to the
// close control on open and is restored on close, and a single-element focus
// trap keeps Tab on the close button. Clicking the backdrop (or the image)
// still dismisses, as before.
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // onClose identity churns as the parent re-renders on sync; read it via ref
  // so the setup effect runs once and doesn't refocus mid-view.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === "Tab") {
        // Only the close button is focusable; keep focus pinned to it.
        e.preventDefault();
        closeRef.current?.focus();
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
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image preview">
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
      <img src={src} alt="" />
    </div>
  );
}

export function TimelineRow({
  item,
  account,
  handle,
  onReply,
  onEdit,
  onZoom,
  onUserMenu,
  onEmojiPicker,
  onActionSheet,
  onViewSource,
  onForward,
  onOpenThread,
  threadOpen,
}: {
  item: TimelineItem;
  account: MatrixAccount;
  handle: RoomHandle;
  onReply: (item: TimelineItem) => void;
  onEdit: (item: TimelineItem) => void;
  onZoom: (url: string) => void;
  onUserMenu: (menu: MenuState) => void;
  onEmojiPicker: (p: { x: number; y: number; eventId: string }) => void;
  /** Open the full-screen long-press action sheet for this message (touch). */
  onActionSheet?: (sheet: SheetState) => void;
  /** Show an event's raw wire JSON (the "View source" action). */
  onViewSource?: (src: string | undefined) => void;
  onForward?: (eventId: string) => void;
  onOpenThread?: (rootEventId: string) => void;
  /** Whether this root's inline thread is currently expanded (chip reflects it). */
  threadOpen?: boolean;
}) {
  const { show, showError } = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  // A deliberate long-press opens the full-screen action sheet. `openSheet` is
  // defined further down (it needs `mine`/`canEdit`/`react`, computed after the
  // early kind-returns), so the press timer reaches it through this ref — which
  // is refreshed every render and therefore never holds a stale closure.
  const openSheetRef = useRef<() => void>(() => {});

  // Touch: only a deliberate long-press on the bubble opens the action sheet.
  // A timer starts on pointerdown and is cancelled by ANY sign of a scroll or
  // gesture: movement past a small slop on either axis, pointerup (a tap),
  // pointercancel (the browser took the gesture over — `touch-action: pan-y`
  // guarantees it fires once vertical panning starts), a second finger, or any
  // `scroll` event on the timeline container while the timer is pending (if
  // the list moved at all, it's a scroll, not a long-press). `fired` swallows
  // the synthetic click that follows a completed long-press; `touch` routes
  // long-press-generated contextmenu events (Android fires those) away from
  // the desktop menu. All mutable state lives in a ref, so re-renders while a
  // room re-virtualizes never leave stale closures armed; the scroll-cancel is
  // a capture-phase document listener attached per press, so it watches
  // whatever scroll container actually exists at press time.
  const press = useRef<{
    timer: number | null;
    x: number;
    y: number;
    pointerId: number | null;
    fired: boolean;
    touch: boolean;
    detachScroll: (() => void) | null;
  }>({ timer: null, x: 0, y: 0, pointerId: null, fired: false, touch: false, detachScroll: null });
  const cancelPress = () => {
    const p = press.current;
    if (p.timer !== null) {
      window.clearTimeout(p.timer);
      p.timer = null;
    }
    p.pointerId = null;
    p.detachScroll?.();
    p.detachScroll = null;
  };
  useEffect(() => cancelPress, []);
  const onPressStart = (e: React.PointerEvent) => {
    const p = press.current;
    p.touch = e.pointerType !== "mouse";
    p.fired = false;
    if (e.pointerType === "mouse") return; // desktop: hover + right-click as before
    if (p.timer !== null) {
      // A second finger landed while a press was pending: that's a gesture
      // (pinch/two-finger scroll), never a long-press.
      cancelPress();
      return;
    }
    if (!e.isPrimary) return; // only the primary touch pointer arms
    const target = e.target as HTMLElement;
    if (!target.closest(".bubble") || target.closest("a")) return;
    p.x = e.clientX;
    p.y = e.clientY;
    p.pointerId = e.pointerId;
    // Scroll events don't bubble, but a capture-phase document listener sees
    // every scroll target — the .timeline container, the document itself, or
    // whatever container exists after a reflow — so this can't go stale.
    const onScroll = () => cancelPress();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    p.detachScroll = () => document.removeEventListener("scroll", onScroll, { capture: true });
    p.timer = window.setTimeout(() => {
      p.timer = null;
      p.detachScroll?.();
      p.detachScroll = null;
      p.fired = true;
      openSheetRef.current();
    }, 470);
  };
  const onPressMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (p.timer === null || e.pointerId !== p.pointerId) return;
    if (Math.abs(e.clientX - p.x) > 8 || Math.abs(e.clientY - p.y) > 8) cancelPress();
  };

  const openUserMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const userId = item.sender.userId;
    onUserMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildUserMenu(account, userId, {
        show,
        showError,
        roomId: handle.roomId,
        canBan: handle.canBan(),
        onBan: () => {
          prompt({
            title: `Ban ${item.sender.name} from this room?`,
            label: "Reason (optional)",
            danger: true,
            confirmLabel: "Ban",
          }).then((reason) => {
            if (reason === null) return;
            handle
              .ban(userId, reason || undefined)
              .then(() => show("User banned."))
              .catch(showError);
          });
        },
        canChangePower: handle.canChangePower(),
        myLevel: handle.myLevel(),
        targetLevel: handle.powerLevelOf(userId),
        defaultLevel: handle.defaultPowerLevel(),
        onSetPower: (level) => {
          handle
            .setPowerLevel(userId, level)
            .then(() => show(powerLevelMessage(item.sender.name, level, handle.defaultPowerLevel())))
            .catch(showError);
        },
      }),
    });
  };

  if (item.kind === "day-divider") {
    return <div className="day-divider">{formatDayDivider(item.ts)}</div>;
  }
  if (item.kind === "read-marker") {
    return <div className="read-marker">New messages</div>;
  }
  if (item.kind === "member" || item.kind === "state") {
    return <div className="state-line">{item.stateText}</div>;
  }
  if (item.kind === "ignored") {
    return <div className="state-line ignored-msg">Message from ignored user</div>;
  }

  const mine = !!item.isMine;
  // Edit is only offered once the server has acknowledged the message: a
  // pending local echo still carries a `~roomId:txnId` placeholder id and a
  // "sending"/"failed" sendState, and targeting it with an m.replace races the
  // original send (server-side errors). A fully synced event has a real `$…`
  // id and no sendState; a just-acked one reports "sent".
  const serverAcked =
    !!item.eventId &&
    !item.eventId.startsWith("~") &&
    item.sendState !== "sending" &&
    item.sendState !== "failed";
  const canEdit = mine && item.body?.msgtype === "m.text" && serverAcked;
  const react = (key: string) => {
    if (item.eventId) handle.react(item.eventId, key).catch(showError);
  };

  // Build and open the full-screen long-press action sheet: the pressed message
  // pinned at the top, a quick-reaction row (with a "+" that opens the full
  // picker), and the vertical action list — the reworked replacement for the
  // context menu that the long-press icon bar had displaced. Same actions and
  // handlers as the desktop right-click menu / hover bar.
  const openSheet = () => {
    if (item.kind !== "message" || !item.eventId) return;
    const eventId = item.eventId;
    const actions: MenuItem[] = [{ label: "Reply", icon: <IconReply size={18} />, onClick: () => onReply(item) }];
    if (onOpenThread)
      actions.push({ label: "Reply in thread", icon: <IconThreads size={18} />, onClick: () => onOpenThread(eventId) });
    if (onForward) actions.push({ label: "Forward", icon: <IconForward size={18} />, onClick: () => onForward(eventId) });
    if (item.body?.text)
      actions.push({
        label: "Copy text",
        icon: <IconCopy size={18} />,
        onClick: () => copyText(item.body!.text ?? "").then(() => show("Copied."), showError),
      });
    if (handle.canPin()) {
      const pinned = handle.isPinned(eventId);
      actions.push({
        label: pinned ? "Unpin" : "Pin",
        icon: <IconPin size={18} />,
        onClick: () => (pinned ? handle.unpin(eventId) : handle.pin(eventId)).catch(showError),
      });
    }
    if (canEdit) actions.push({ label: "Edit", icon: <IconEdit size={18} />, onClick: () => onEdit(item) });
    actions.push({ label: "View source", icon: <IconInfo size={18} />, onClick: () => onViewSource?.(handle.source(eventId)) });
    if (!mine)
      actions.push({
        label: "Report message",
        danger: true,
        icon: <IconAlert size={18} />,
        onClick: () => {
          const reasons = ["Spam", "Inappropriate content", "Harassment", "Illegal content", "Other"];
          onUserMenu({
            x: Math.round(window.innerWidth / 2),
            y: Math.round(window.innerHeight / 2),
            items: reasons.map((reason) => ({
              label: reason,
              onClick: () =>
                handle
                  .report(eventId, reason)
                  .then(() => show("Message reported."))
                  .catch(showError),
            })),
          });
        },
      });
    if (mine || handle.canRedactOthers())
      actions.push({
        label: mine ? "Remove" : "Remove (moderator)",
        danger: true,
        icon: <IconTrash size={18} />,
        onClick: () => {
          confirm({ title: "Delete this message for everyone?", danger: true, confirmLabel: "Delete" }).then(
            (ok) => {
              if (ok) handle.redact(eventId).catch(showError);
            },
          );
        },
      });

    onActionSheet?.({
      item,
      quickReactions: QUICK_REACTIONS,
      onReact: react,
      onAddReaction: () =>
        onEmojiPicker({ x: Math.round(window.innerWidth / 2) - 150, y: Math.round(window.innerHeight / 2) - 160, eventId }),
      actions,
    });
  };
  openSheetRef.current = openSheet;

  // Build and open the message context menu at a viewport position — shared by
  // the desktop right-click and the keyboard path so both offer identical
  // actions.
  const openMenuAt = (x: number, y: number) => {
    if (item.kind !== "message" || !item.eventId) return;
    const eventId = item.eventId;
    const items: MenuItem[] = [
      { label: "Reply", onClick: () => onReply(item) },
      { label: "Add reaction", onClick: () => onEmojiPicker({ x: x - 300, y: y + 6, eventId }) },
    ];
    if (onForward) items.push({ label: "Forward", onClick: () => onForward(eventId) });
    if (onOpenThread) items.push({ label: "Reply in thread", onClick: () => onOpenThread(eventId) });
    if (handle.canPin()) {
      const pinned = handle.isPinned(eventId);
      items.push({
        label: pinned ? "Unpin" : "Pin",
        onClick: () => (pinned ? handle.unpin(eventId) : handle.pin(eventId)).catch(showError),
      });
    }
    if (item.body?.text)
      items.push({
        label: "Copy text",
        onClick: () => copyText(item.body!.text ?? "").then(() => show("Copied."), showError),
      });
    if (canEdit) items.push({ label: "Edit", onClick: () => onEdit(item) });
    if (!mine)
      items.push({
        label: "Report message",
        danger: true,
        onClick: () => {
          // Second-level menu of preset reasons; picking one reports immediately.
          const reasons = ["Spam", "Inappropriate content", "Harassment", "Illegal content", "Other"];
          onUserMenu({
            x,
            y,
            items: reasons.map((reason) => ({
              label: reason,
              onClick: () =>
                handle
                  .report(eventId, reason)
                  .then(() => show("Message reported."))
                  .catch(showError),
            })),
          });
        },
      });
    // Only offer removal when it can actually succeed: own messages always, or
    // others' with moderator power (labelled so, mirroring the action sheet).
    if (mine || handle.canRedactOthers())
      items.push({
        label: mine ? "Remove" : "Remove (moderator)",
        danger: true,
        onClick: () => {
          confirm({ title: "Delete this message for everyone?", danger: true, confirmLabel: "Delete" }).then(
            (ok) => {
              if (ok) handle.redact(eventId).catch(showError);
            },
          );
        },
      });
    onUserMenu({ x, y, items });
  };

  // Right-click a message → native-style context menu with the same actions as
  // the hover bar. Defers to the sender/avatar menu when those were targeted.
  const openMsgMenu = (e: React.MouseEvent) => {
    if (item.kind !== "message" || !item.eventId) return;
    if ((e.target as HTMLElement).closest(".msg-sender, .avatar-btn")) return;
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  };

  // Keyboard path (issue #5 a11y): a focused message row opens the same action
  // menu with Enter or the dedicated ContextMenu key, anchored to the row's
  // centre. The menu itself handles Escape/arrow navigation and closing.
  const onRowKeyDown = (e: React.KeyboardEvent) => {
    if (item.kind !== "message" || !item.eventId) return;
    if (e.target !== e.currentTarget) return; // let child controls keep their keys
    if (e.key === "Enter" || e.key === "ContextMenu") {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openMenuAt(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    }
  };

  return (
    <div
      className={`msg-row${mine ? " mine" : ""}${item.groupStart ? " group-start" : ""}`}
      data-event-id={item.eventId}
      tabIndex={item.kind === "message" && item.eventId ? 0 : undefined}
      aria-haspopup={item.kind === "message" && item.eventId ? "menu" : undefined}
      onKeyDown={onRowKeyDown}
      onContextMenu={(e) => {
        // Android synthesizes contextmenu from a long-press; touch is handled
        // by the long-press action bar, so only real right-clicks open the menu.
        if (press.current.touch) {
          e.preventDefault();
          return;
        }
        openMsgMenu(e);
      }}
      onPointerDown={onPressStart}
      onPointerMove={onPressMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onClick={(e) => {
        if (press.current.fired) {
          // Swallow the synthetic click that follows a long-press so it doesn't
          // fall through to the timeline (e.g. link-open) after the sheet opens.
          press.current.fired = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="msg-avatar-slot">
        {item.groupStart && (
          <button
            className="avatar-btn"
            onClick={openUserMenu}
            onContextMenu={openUserMenu}
            aria-label={`Actions for ${item.sender.name}`}
            aria-haspopup="menu"
          >
            <Avatar account={account} mxc={item.sender.avatarUrl} name={item.sender.name} id={item.sender.userId} size={36} />
          </button>
        )}
      </div>
      <div className="msg-content">
        {item.groupStart && !mine && (
          <div className="msg-meta">
            <button
              className="msg-sender"
              style={{ color: `hsl(${hashHue(item.sender.userId)} 55% 45%)` }}
              onClick={openUserMenu}
              onContextMenu={openUserMenu}
              aria-haspopup="menu"
            >
              {item.sender.name}
            </button>
            <span className="msg-time">{formatTime(item.ts)}</span>
          </div>
        )}
        <div className="msg-bubble-row">
        {item.kind === "redacted" ? (
          <div className="bubble utd">Message deleted</div>
        ) : item.kind === "encrypted-pending" ? (
          <div className="bubble utd">
            <IconLock size={14} /> Waiting for this message…
          </div>
        ) : item.kind === "poll" && item.poll ? (
          <div className="bubble">
            <PollView poll={item.poll} mine={mine} handle={handle} />
          </div>
        ) : (
          <MessageBubble item={item} account={account} onZoom={onZoom} />
        )}
        <MsgFooter item={item} handle={handle} />
        {item.reactions && (
          <div className="reactions">
            {item.reactions.map((r) => (
              <button
                key={r.key}
                className={`reaction-chip${r.mine ? " mine" : ""}`}
                onClick={() => react(r.key)}
                aria-label={`${r.key} ${r.count}, ${r.mine ? "remove your reaction" : "react"}`}
              >
                <span>{r.key}</span>
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
        {onOpenThread && item.eventId && item.threadReplyCount && item.threadReplyCount > 0 && (
          <button
            className={`thread-chip${threadOpen ? " open" : ""}`}
            onClick={() => onOpenThread(item.eventId!)}
            aria-expanded={threadOpen}
            aria-label={`${threadOpen ? "Collapse" : "Open"} thread, ${item.threadReplyCount} ${item.threadReplyCount === 1 ? "reply" : "replies"}`}
          >
            <IconChat size={13} />
            <span>
              {item.threadReplyCount} {item.threadReplyCount === 1 ? "reply" : "replies"}
            </span>
            <IconChevronDown size={13} className="thread-chip-caret" />
          </button>
        )}
        {item.receipts && item.receipts.length > 0 && (
          <div className="msg-receipts" title={`Read by ${item.receipts.map((r) => r.name).join(", ")}`}>
            {item.receipts.map((r) => (
              <Avatar key={r.userId} account={account} mxc={r.avatarUrl} name={r.name} id={r.userId} size={14} />
            ))}
          </div>
        )}
        {item.kind === "message" && item.eventId && (
        <div className="msg-actions" role="toolbar" aria-label="Message actions">
          {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
            <button key={emoji} onClick={() => react(emoji)} title={`React ${emoji}`}>
              {emoji}
            </button>
          ))}
          <button onClick={() => onReply(item)} title="Reply" aria-label="Reply">
            <IconReply size={15} />
          </button>
          {onForward && (
            <button onClick={() => onForward(item.eventId!)} title="Forward" aria-label="Forward">
              <IconForward size={15} />
            </button>
          )}
          {onOpenThread && (
            <button onClick={() => onOpenThread(item.eventId!)} title="Reply in thread" aria-label="Reply in thread">
              <IconChat size={15} />
            </button>
          )}
          {canEdit && (
            <button onClick={() => onEdit(item)} title="Edit" aria-label="Edit">
              <IconEdit size={15} />
            </button>
          )}
          {handle.canPin() &&
            (() => {
              const pinned = handle.isPinned(item.eventId!);
              return (
                <button
                  className={pinned ? "active" : undefined}
                  onClick={() => (pinned ? handle.unpin(item.eventId!) : handle.pin(item.eventId!)).catch(showError)}
                  title={pinned ? "Unpin" : "Pin"}
                  aria-label={pinned ? "Unpin message" : "Pin message"}
                  aria-pressed={pinned}
                >
                  <IconPin size={15} />
                </button>
              );
            })()}
          <button
            onClick={() => {
              confirm({ title: "Delete this message for everyone?", danger: true, confirmLabel: "Delete" }).then(
                (ok) => {
                  if (ok) handle.redact(item.eventId!).catch(showError);
                },
              );
            }}
            title="Delete"
            aria-label="Delete"
          >
            <IconTrash size={15} />
          </button>
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onEmojiPicker({ x: r.left - 300, y: r.bottom + 6, eventId: item.eventId! });
            }}
            title="More reactions"
            aria-label="More reactions"
            aria-haspopup="dialog"
          >
            <IconSmile size={15} />
          </button>
        </div>
        )}
        </div>
      </div>
    </div>
  );
}

export interface SheetState {
  /** The long-pressed message, rendered pinned at the top of the sheet. */
  item: TimelineItem;
  /** Quick-reaction emoji shown as the top row. */
  quickReactions: string[];
  /** Apply a quick reaction to the message. */
  onReact: (emoji: string) => void;
  /** Open the full emoji/reaction picker (the row's "+" button). */
  onAddReaction: () => void;
  /** Vertical list of menu actions (Reply, Forward, Pin, Edit, Remove, …). */
  actions: MenuItem[];
}

// Full-screen long-press overlay, modelled on how Element (Classic) presents a
// long-pressed message: a dimmed/blurred backdrop, the pressed message pinned
// at the top, a horizontal quick-reaction row (with a "+" to the full picker),
// then the vertical action list. Replaces the standalone reaction/action icon
// bar on touch — the reaction bar is folded into the top row here.
function MessageActionSheet({
  sheet,
  account,
  onClose,
}: {
  sheet: SheetState;
  account: MatrixAccount;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { item } = sheet;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="msg-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Message actions"
      // A press on the backdrop (anywhere outside the inner card) dismisses.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="msg-sheet-inner" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
        <div className={`msg-sheet-message${item.isMine ? " mine" : ""}`}>
          <div className="msg-sheet-sender" style={{ color: `hsl(${hashHue(item.sender.userId)} 55% 55%)` }}>
            {item.sender.name}
            <span className="msg-time">{formatTime(item.ts)}</span>
          </div>
          <div className="msg-bubble-row">
            {item.kind === "redacted" ? (
              <div className="bubble utd">Message deleted</div>
            ) : item.body ? (
              <MessageBubble item={item} account={account} onZoom={() => undefined} />
            ) : null}
          </div>
        </div>

        <div className="msg-sheet-reactions" role="toolbar" aria-label="Quick reactions">
          {sheet.quickReactions.map((emoji) => (
            <button
              key={emoji}
              className="msg-sheet-react"
              onClick={() => {
                onClose();
                sheet.onReact(emoji);
              }}
              aria-label={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            className="msg-sheet-react msg-sheet-more"
            onClick={() => {
              onClose();
              sheet.onAddReaction();
            }}
            title="More reactions"
            aria-label="More reactions"
            aria-haspopup="dialog"
          >
            <IconPlus size={20} />
          </button>
        </div>

        <div className="msg-sheet-actions" role="menu">
          {sheet.actions.map((a, i) => (
            <button
              key={i}
              role="menuitem"
              className={a.danger ? "danger" : undefined}
              onClick={() => {
                onClose();
                a.onClick();
              }}
            >
              <span className="msg-sheet-action-icon">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MsgFooter({ item, handle }: { item: TimelineItem; handle: RoomHandle }) {
  const { showError } = useToast();
  const parts: ReactNode[] = [];
  if (item.isMine && item.groupStart === false) {
    // time shown in meta for group starts of others; mine shows in footer
  }
  if (item.isMine) parts.push(<span key="t">{formatTime(item.ts)}</span>);
  if (item.edited) parts.push(<span key="e">(edited)</span>);
  if (item.sendState === "sending") parts.push(<IconClock key="s" size={12} aria-label="Sending" />);
  if (item.sendState === "sent") parts.push(<IconCheck key="s" size={12} aria-label="Sent" />);
  if (item.sendState === "failed")
    parts.push(
      <button
        key="s"
        className="failed"
        onClick={() => handle.resend(item.id).catch(showError)}
        title="Tap to retry"
      >
        <IconAlert size={12} /> Failed — retry
      </button>,
    );
  if (!parts.length) return null;
  return <div className="msg-footer">{parts}</div>;
}

function PollView({
  poll,
  mine,
  handle,
}: {
  poll: import("../core/types").PollData;
  mine: boolean;
  handle: RoomHandle;
}) {
  const { showError } = useToast();
  const confirm = useConfirm();
  // Show results once you've voted, the poll is undisclosed-and-ended, or it ended.
  const hasVoted = poll.answers.some((a) => a.chosenByMe);
  const showResults = poll.ended || (poll.kind === "disclosed" && hasVoted);

  const vote = (answerId: string) => {
    if (poll.ended) return;
    let next: string[];
    if (poll.maxSelections > 1) {
      const current = poll.answers.filter((a) => a.chosenByMe).map((a) => a.id);
      next = current.includes(answerId) ? current.filter((a) => a !== answerId) : [...current, answerId].slice(-poll.maxSelections);
    } else {
      next = [answerId];
    }
    handle.votePoll(poll.eventId, next).catch(showError);
  };

  const multi = poll.maxSelections > 1;
  return (
    <div className="poll">
      <div className="poll-question">
        {poll.question}
        {poll.ended ? " · Final results" : multi ? " · Choose multiple" : ""}
      </div>
      <div className="poll-options" role={multi ? "group" : "radiogroup"} aria-label={poll.question}>
        {poll.answers.map((a) => {
          const pctOfTotal = poll.totalVotes ? Math.round((a.votes / poll.totalVotes) * 100) : 0;
          // Checkbox glyphs for multi-select, radio glyphs for single-select.
          const mark = multi ? (a.chosenByMe ? "☑" : "☐") : a.chosenByMe ? "◉" : "○";
          return (
            <button
              key={a.id}
              className={`poll-option${a.chosenByMe ? " chosen" : ""}`}
              onClick={() => vote(a.id)}
              disabled={poll.ended}
              role={multi ? "checkbox" : "radio"}
              aria-checked={a.chosenByMe}
            >
              <span className="poll-option-top">
                <span className="poll-option-label">
                  <span className="poll-mark" aria-hidden="true">
                    {mark}
                  </span>
                  {a.text}
                </span>
                {showResults && <span className="poll-pct">{pctOfTotal}%</span>}
              </span>
              {showResults && <span className="poll-option-bar" style={{ width: `${pctOfTotal}%` }} />}
            </button>
          );
        })}
      </div>
      <div className="poll-total">
        {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
        {mine && !poll.ended && (
          <>
            {" · "}
            <button
              style={{ color: "var(--accent-strong)" }}
              onClick={() => {
                confirm({
                  title: "End this poll?",
                  body: "Results become final.",
                  confirmLabel: "End poll",
                }).then((ok) => {
                  if (ok) handle.endPoll(poll.eventId).catch(showError);
                });
              }}
            >
              End poll
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  item,
  account,
  onZoom,
}: {
  item: TimelineItem;
  account: MatrixAccount;
  onZoom: (url: string) => void;
}) {
  const body = item.body!;
  const isMedia = body.msgtype === "m.image" || body.msgtype === "m.video";
  return (
    <div className={`bubble${isMedia ? " media" : ""}`}>
      {item.replyTo && (
        <div className="reply-quote" title={item.replyTo.preview}>
          <div className="reply-quote-sender">{item.replyTo.sender || "Message"}</div>
          <div className="reply-quote-text">{item.replyTo.preview}</div>
        </div>
      )}
      <MessageContent body={body} account={account} onZoom={onZoom} trackId={item.id} />
    </div>
  );
}

// Auto-link bare URLs in plain-text messages. Clicks are intercepted by the
// timeline-level handler for safety checks.
const URL_RE = /(https?:\/\/[^\s<]+)/g;
function LinkedText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0];
    let tail = "";
    const trail = url.match(/[.,!?;:)\]}]+$/); // don't swallow trailing punctuation
    if (trail) {
      tail = trail[0];
      url = url.slice(0, url.length - tail.length);
    }
    out.push(
      <a key={m.index} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function MessageContent({
  body,
  account,
  onZoom,
  trackId,
}: {
  body: MessageBody;
  account: MatrixAccount;
  onZoom: (url: string) => void;
  trackId: string;
}) {
  if (body.msgtype === "m.text" || body.msgtype === "m.notice" || body.msgtype === "m.emote") {
    if (body.html) {
      // Sanitized in core (sanitizeIncomingHtml) before reaching the UI.
      return <div dangerouslySetInnerHTML={{ __html: body.html }} />;
    }
    return (
      <div style={{ whiteSpace: "pre-wrap" }}>
        {body.msgtype === "m.emote" && "* "}
        <LinkedText text={body.text} />
      </div>
    );
  }
  if (body.msgtype === "m.image") return <ImageContent body={body} account={account} onZoom={onZoom} />;
  if (body.msgtype === "m.video") return <VideoContent body={body} account={account} />;
  if (body.msgtype === "m.location") return <LocationContent body={body} />;
  if (body.msgtype === "m.audio") return <AudioContent body={body} account={account} trackId={trackId} />;
  if (body.msgtype === "m.file") return <FileContent body={body} account={account} />;
  return null;
}

interface MediaSrc {
  src?: string;
  /** The fetch/decrypt failed — show a retry affordance instead of a skeleton. */
  error: boolean;
  /** Re-run the fetch (the cache dropped the rejected entry, so this refetches). */
  retry: () => void;
}

function useMediaSrc(
  account: MatrixAccount,
  mxc: string | undefined,
  enc: Parameters<typeof encryptedMediaUrl>[1] | undefined,
  mime?: string,
  thumb?: { w: number; h: number },
): MediaSrc {
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
    const p = enc
      ? encryptedMediaUrl(account.client, enc, mime)
      : mxc
        ? mediaUrl(account.client, mxc, thumb)
        : undefined;
    if (!p) return;
    p.then((u) => {
      if (alive) setSrc(u);
    }).catch(() => {
      if (alive) setError(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, mxc, enc?.url, attempt]);
  return { src, error, retry };
}

function ImageContent({
  body,
  account,
  onZoom,
}: {
  body: Extract<MessageBody, { msgtype: "m.image" | "m.video" }>;
  account: MatrixAccount;
  onZoom: (url: string) => void;
}) {
  // Prefer the thumbnail for the timeline; fall back to full image.
  const thumb = useMediaSrc(
    account,
    body.thumbMxc ?? body.mxc,
    body.thumbFile ?? body.file,
    body.thumbFile ? undefined : body.mime,
    body.thumbMxc && !body.thumbFile ? { w: 640, h: 480 } : undefined,
  );
  const full = useMediaSrc(account, body.mxc, body.file, body.mime);
  const ratio = body.w && body.h ? Math.min(3, Math.max(0.4, body.w / body.h)) : undefined;
  if (thumb.error) {
    return (
      <MediaError
        className="msg-img-error"
        style={{ width: 280, aspectRatio: ratio ?? 1.4, maxWidth: "100%" }}
        onRetry={thumb.retry}
      />
    );
  }
  if (!thumb.src) {
    return <div className="skeleton" style={{ width: 280, aspectRatio: ratio ?? 1.4, maxWidth: "100%" }} />;
  }
  return (
    <button
      type="button"
      className="msg-img-btn"
      onClick={() => onZoom(full.src ?? thumb.src!)}
      aria-label={body.text ? `Open image: ${body.text}` : "Open image"}
    >
      <img
        className="msg-img"
        src={thumb.src}
        alt={body.text}
        style={ratio ? { aspectRatio: ratio } : undefined}
        loading="lazy"
      />
    </button>
  );
}

// Shared "couldn't load — tap to retry" affordance for media that failed to
// fetch or decrypt, in place of an eternal skeleton/spinner.
function MediaError({
  onRetry,
  className,
  style,
}: {
  onRetry: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button type="button" className={`media-error${className ? ` ${className}` : ""}`} style={style} onClick={onRetry}>
      <IconAlert size={20} />
      <span>Couldn't load — tap to retry</span>
    </button>
  );
}

function VideoContent({
  body,
  account,
}: {
  body: Extract<MessageBody, { msgtype: "m.image" | "m.video" }>;
  account: MatrixAccount;
}) {
  const isEncrypted = !!body.file;
  const poster = useMediaSrc(
    account,
    body.thumbMxc,
    body.thumbFile,
    body.thumbFile ? undefined : "image/jpeg",
    body.thumbMxc && !body.thumbFile ? { w: 640, h: 480 } : undefined,
  );
  // Unencrypted video streams straight from the homeserver; an encrypted one
  // must be downloaded and decrypted whole, so defer that until the user hits
  // play (the click is also the gesture that lets it autoplay).
  const [play, setPlay] = useState(!isEncrypted);
  const src = useMediaSrc(account, play ? body.mxc : undefined, play ? body.file : undefined, body.mime);
  const ratio = body.w && body.h ? Math.min(3, Math.max(0.4, body.w / body.h)) : 16 / 9;

  if (isEncrypted && !play) {
    return (
      <button
        type="button"
        className="msg-video msg-video-poster"
        style={{ aspectRatio: ratio }}
        onClick={() => setPlay(true)}
        aria-label="Play video"
      >
        {poster.src && <img src={poster.src} alt={body.text} />}
        <span className="msg-video-play">
          <IconPlay size={26} />
        </span>
        {body.durationMs ? <span className="msg-video-dur">{formatDuration(body.durationMs)}</span> : null}
      </button>
    );
  }
  if (src.error) {
    return <MediaError className="msg-video-error" style={{ aspectRatio: ratio, width: 320, maxWidth: "100%" }} onRetry={src.retry} />;
  }
  if (!src.src) {
    return (
      <div className="msg-video msg-video-poster loading" style={{ aspectRatio: ratio }}>
        {poster.src && <img src={poster.src} alt={body.text} />}
        <span className="msg-video-play">
          <IconPlay size={26} />
        </span>
      </div>
    );
  }
  return (
    <video
      className="msg-video"
      src={src.src}
      poster={poster.src}
      controls
      autoPlay={isEncrypted}
      preload="metadata"
      style={{ aspectRatio: ratio }}
    />
  );
}

function FileContent({
  body,
  account,
}: {
  body: Extract<MessageBody, { msgtype: "m.file" }>;
  account: MatrixAccount;
}) {
  const { src, error, retry } = useMediaSrc(account, body.mxc, body.file, body.mime);
  if (error) {
    return <MediaError className="msg-file-error" onRetry={retry} />;
  }
  return (
    <a className="msg-file" href={src} download={body.text} aria-disabled={!src}>
      <span className="msg-file-icon">
        <IconFile size={20} />
      </span>
      <span style={{ minWidth: 0 }}>
        <div className="msg-file-name">{body.text}</div>
        <div className="msg-file-size">{formatSize(body.size)}</div>
      </span>
      <IconDownload size={16} />
    </a>
  );
}

function LocationContent({ body }: { body: Extract<MessageBody, { msgtype: "m.location" }> }) {
  const hasPos = body.lat !== undefined && body.lon !== undefined;
  if (!hasPos) {
    return (
      <div className="msg-file">
        <span className="msg-file-icon">
          <IconLocation size={20} />
        </span>
        <span className="msg-file-name">{body.text || "Shared location"}</span>
      </div>
    );
  }
  const d = 0.004;
  const bbox = `${body.lon! - d},${body.lat! - d},${body.lon! + d},${body.lat! + d}`;
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${body.lat},${body.lon}`;
  const openUrl = `https://www.openstreetmap.org/?mlat=${body.lat}&mlon=${body.lon}#map=16/${body.lat}/${body.lon}`;
  return (
    <div className="msg-location">
      <iframe title={body.text || "Shared location"} src={embedSrc} loading="lazy" />
      <a className="msg-location-foot" href={openUrl} target="_blank" rel="noopener noreferrer">
        <IconLocation size={14} />
        <span>{body.text || "Shared location"}</span>
      </a>
    </div>
  );
}

function AudioContent({
  body,
  account,
  trackId,
}: {
  body: Extract<MessageBody, { msgtype: "m.audio" }>;
  account: MatrixAccount;
  trackId: string;
}) {
  const { src } = useMediaSrc(account, body.mxc, body.file, body.mime);
  return (
    <AudioPlayer
      trackId={trackId}
      src={src}
      name={body.text}
      voice={body.voice}
      durationMs={body.durationMs}
      waveform={body.waveform}
    />
  );
}

function hashHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
