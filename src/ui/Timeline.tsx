// Message timeline: scroll management (stick to bottom, load older on top),
// message bubbles, media, reactions, hover actions.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MatrixAccount } from "../core/account";
import type { RoomHandle } from "../core/roomHandle";
import type { MessageBody, TimelineItem } from "../core/types";
import { encryptedMediaUrl, mediaUrl } from "../core/media";
import { useRoomVersion } from "./hooks";
import { Avatar } from "./components/Avatar";
import { ContextMenu, type MenuState } from "./components/ContextMenu";
import { EmojiPicker } from "./components/EmojiPicker";
import { AudioPlayer } from "./components/AudioPlayer";
import { buildUserMenu } from "./userMenu";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconDownload,
  IconEdit,
  IconFile,
  IconLocation,
  IconLock,
  IconReply,
  IconSmile,
  IconTrash,
} from "./components/Icons";
import { formatDayDivider, formatSize, formatTime } from "./format";
import { useToast } from "./components/Toast";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

export function Timeline({
  account,
  handle,
  onReply,
  onEdit,
}: {
  account: MatrixAccount;
  handle: RoomHandle;
  onReply: (item: TimelineItem) => void;
  onEdit: (item: TimelineItem) => void;
}) {
  const version = useRoomVersion(account, handle.roomId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; eventId: string } | null>(null);
  const { showError } = useToast();

  const items = handle.timeline();

  // On room open: jump to the first unread (read marker) when present,
  // otherwise to the bottom.
  useEffect(() => {
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
        .catch(showError)
        .finally(() => setLoadingOlder(false));
    }
  };

  return (
    <>
      <div className="timeline" ref={scrollRef} onScroll={onScroll} tabIndex={0} aria-label="Messages">
        <div className="timeline-inner">
          {loadingOlder && (
            <div className="state-line" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="spinner" /> Loading history…
            </div>
          )}
          {items.map((item) => (
            <TimelineRow
              key={item.id}
              item={item}
              account={account}
              handle={handle}
              onReply={onReply}
              onEdit={onEdit}
              onZoom={setLightbox}
              onUserMenu={setMenu}
              onEmojiPicker={setPicker}
            />
          ))}
          {items.length === 0 && (
            <div className="empty-state">
              <div className="empty-glyph">
                <IconLock size={30} />
              </div>
              <h2>No messages yet</h2>
              <p>Say hello — messages in encrypted rooms are only readable by members.</p>
            </div>
          )}
        </div>
      </div>
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
    </>
  );
}

function TimelineRow({
  item,
  account,
  handle,
  onReply,
  onEdit,
  onZoom,
  onUserMenu,
  onEmojiPicker,
}: {
  item: TimelineItem;
  account: MatrixAccount;
  handle: RoomHandle;
  onReply: (item: TimelineItem) => void;
  onEdit: (item: TimelineItem) => void;
  onZoom: (url: string) => void;
  onUserMenu: (menu: MenuState) => void;
  onEmojiPicker: (p: { x: number; y: number; eventId: string }) => void;
}) {
  const { show, showError } = useToast();

  const [showActions, setShowActions] = useState(false);

  const openUserMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onUserMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildUserMenu(account, item.sender.userId, { show, showError }),
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

  const mine = !!item.isMine;
  const react = (key: string) => {
    if (item.eventId) handle.react(item.eventId, key).catch(showError);
  };

  return (
    <div
      className={`msg-row${mine ? " mine" : ""}${item.groupStart ? " group-start" : ""}${showActions ? " show-actions" : ""}`}
      onClick={(e) => {
        // On touch (no hover), tap toggles the action bar.
        if (window.matchMedia("(hover: none)").matches && (e.target as HTMLElement).closest(".bubble")) {
          setShowActions((v) => !v);
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
        {item.receipts && item.receipts.length > 0 && (
          <div className="msg-receipts" title={`Read by ${item.receipts.map((r) => r.name).join(", ")}`}>
            {item.receipts.map((r) => (
              <Avatar key={r.userId} account={account} mxc={r.avatarUrl} name={r.name} id={r.userId} size={14} />
            ))}
          </div>
        )}
      </div>
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
          {mine && item.body?.msgtype === "m.text" && (
            <button onClick={() => onEdit(item)} title="Edit" aria-label="Edit">
              <IconEdit size={15} />
            </button>
          )}
          <button
            onClick={() => {
              if (confirm("Delete this message for everyone?")) {
                handle.redact(item.eventId!).catch(showError);
              }
            }}
            title="Delete"
            aria-label="Delete"
          >
            <IconTrash size={15} />
          </button>
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onEmojiPicker({ x: r.left - 260, y: r.bottom + 6, eventId: item.eventId! });
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

  return (
    <div className="poll">
      <div className="poll-question">
        {poll.question}
        {poll.ended ? " · Final results" : poll.maxSelections > 1 ? " · Choose multiple" : ""}
      </div>
      {poll.answers.map((a) => {
        const pctOfTotal = poll.totalVotes ? Math.round((a.votes / poll.totalVotes) * 100) : 0;
        return (
          <button
            key={a.id}
            className={`poll-option${a.chosenByMe ? " chosen" : ""}`}
            onClick={() => vote(a.id)}
            disabled={poll.ended}
            aria-pressed={a.chosenByMe}
          >
            <span className="poll-option-top">
              <span>
                {a.chosenByMe ? "◉ " : poll.ended ? "○ " : ""}
                {a.text}
              </span>
              {showResults && <span>{pctOfTotal}%</span>}
            </span>
            {showResults && <span className="poll-option-bar" style={{ width: `${pctOfTotal}%` }} />}
          </button>
        );
      })}
      <div className="poll-total">
        {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
        {mine && !poll.ended && (
          <>
            {" · "}
            <button
              style={{ color: "var(--accent-strong)" }}
              onClick={() => {
                if (confirm("End this poll? Results become final.")) handle.endPoll(poll.eventId).catch(showError);
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
      <MessageContent body={body} account={account} onZoom={onZoom} />
    </div>
  );
}

function MessageContent({
  body,
  account,
  onZoom,
}: {
  body: MessageBody;
  account: MatrixAccount;
  onZoom: (url: string) => void;
}) {
  if (body.msgtype === "m.text" || body.msgtype === "m.notice" || body.msgtype === "m.emote") {
    if (body.html) {
      // Sanitized in core (sanitizeIncomingHtml) before reaching the UI.
      return <div dangerouslySetInnerHTML={{ __html: body.html }} />;
    }
    return <div style={{ whiteSpace: "pre-wrap" }}>{body.msgtype === "m.emote" ? `* ${body.text}` : body.text}</div>;
  }
  if (body.msgtype === "m.image") return <ImageContent body={body} account={account} onZoom={onZoom} />;
  if (body.msgtype === "m.video") return <VideoContent body={body} account={account} />;
  if (body.msgtype === "m.location") return <LocationContent body={body} />;
  if (body.msgtype === "m.audio") return <AudioContent body={body} account={account} />;
  if (body.msgtype === "m.file") return <FileContent body={body} account={account} />;
  return null;
}

function useMediaSrc(
  account: MatrixAccount,
  mxc: string | undefined,
  enc: Parameters<typeof encryptedMediaUrl>[1] | undefined,
  mime?: string,
  thumb?: { w: number; h: number },
): string | undefined {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    if (!account.client) return;
    const p = enc
      ? encryptedMediaUrl(account.client, enc, mime)
      : mxc
        ? mediaUrl(account.client, mxc, thumb)
        : undefined;
    p?.then((u) => {
      if (alive) setSrc(u);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, mxc, enc?.url]);
  return src;
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
  const thumbSrc = useMediaSrc(
    account,
    body.thumbMxc ?? body.mxc,
    body.thumbFile ?? body.file,
    body.thumbFile ? undefined : body.mime,
    body.thumbMxc && !body.thumbFile ? { w: 640, h: 480 } : undefined,
  );
  const fullSrc = useMediaSrc(account, body.mxc, body.file, body.mime);
  const ratio = body.w && body.h ? Math.min(3, Math.max(0.4, body.w / body.h)) : undefined;
  if (!thumbSrc) {
    return <div className="skeleton" style={{ width: 280, aspectRatio: ratio ?? 1.4, maxWidth: "100%" }} />;
  }
  return (
    <img
      className="msg-img"
      src={thumbSrc}
      alt={body.text}
      style={ratio ? { aspectRatio: ratio } : undefined}
      onClick={() => onZoom(fullSrc ?? thumbSrc)}
      loading="lazy"
    />
  );
}

function VideoContent({
  body,
  account,
}: {
  body: Extract<MessageBody, { msgtype: "m.image" | "m.video" }>;
  account: MatrixAccount;
}) {
  const src = useMediaSrc(account, body.mxc, body.file, body.mime);
  if (!src) return <div className="skeleton" style={{ width: 320, aspectRatio: 16 / 9, maxWidth: "100%" }} />;
  return <video className="msg-video" src={src} controls preload="metadata" />;
}

function FileContent({
  body,
  account,
}: {
  body: Extract<MessageBody, { msgtype: "m.file" }>;
  account: MatrixAccount;
}) {
  const src = useMediaSrc(account, body.mxc, body.file, body.mime);
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
  const mapUrl =
    body.lat !== undefined && body.lon !== undefined
      ? `https://www.openstreetmap.org/?mlat=${body.lat}&mlon=${body.lon}#map=16/${body.lat}/${body.lon}`
      : undefined;
  return (
    <a
      className="msg-file"
      href={mapUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!mapUrl}
    >
      <span className="msg-file-icon">
        <IconLocation size={20} />
      </span>
      <span style={{ minWidth: 0 }}>
        <div className="msg-file-name">{body.text || "Shared location"}</div>
        {body.lat !== undefined && (
          <div className="msg-file-size">
            {body.lat.toFixed(4)}, {body.lon!.toFixed(4)}
          </div>
        )}
      </span>
    </a>
  );
}

function AudioContent({
  body,
  account,
}: {
  body: Extract<MessageBody, { msgtype: "m.audio" }>;
  account: MatrixAccount;
}) {
  const src = useMediaSrc(account, body.mxc, body.file, body.mime);
  return <AudioPlayer src={src} name={body.text} voice={body.voice} durationMs={body.durationMs} waveform={body.waveform} />;
}

function hashHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
