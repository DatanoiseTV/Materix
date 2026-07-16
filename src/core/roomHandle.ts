// Per-room facade: builds TimelineItem[] snapshots from the SDK timeline and
// carries all room-scoped actions (send, edit, react, receipts, membership).
// Contract: docs/api-contract.md "Core boundary".

import {
  Direction,
  EventStatus,
  EventType,
  type IContent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { encryptAttachment } from "matrix-encrypt-attachment";
import type {
  EncryptedFileInfo,
  MemberSummary,
  MessageBody,
  RoomDetails,
  TimelineItem,
} from "./types";
import { toMaterixError } from "./errors";
import {
  markdownToMatrixHtml,
  sanitizeIncomingHtml,
  stripReplyFallbackHtml,
  stripReplyFallbackText,
  escapeHtml,
} from "./markdown";

const RENDERED_STATE = new Set<string>([
  EventType.RoomMember,
  EventType.RoomName,
  EventType.RoomTopic,
  EventType.RoomCreate,
  EventType.RoomEncryption,
]);

export class RoomHandle {
  constructor(
    private client: MatrixClient,
    private room: Room,
  ) {}

  get roomId(): string {
    return this.room.roomId;
  }

  /** Build the renderable timeline snapshot (oldest first). */
  timeline(): TimelineItem[] {
    const myUserId = this.client.getUserId()!;
    const events = this.room.getLiveTimeline().getEvents();
    let readUpTo = this.room.getEventReadUpTo(myUserId, false);
    // Suppress the marker when everything after it is our own sends —
    // "New messages" above your own message reads as a bug.
    if (readUpTo) {
      const idx = events.findIndex((e) => e.getId() === readUpTo);
      if (idx >= 0 && events.slice(idx + 1).every((e) => e.getSender() === myUserId)) {
        readUpTo = null;
      }
    }
    const items: TimelineItem[] = [];
    let lastDay = "";
    let prev: { sender: string; ts: number } | null = null;

    const push = (ev: MatrixEvent, item: TimelineItem) => {
      const day = new Date(item.ts).toDateString();
      if (day !== lastDay) {
        items.push({
          id: `day-${day}-${item.ts}`,
          kind: "day-divider",
          sender: item.sender,
          ts: item.ts,
        });
        lastDay = day;
        prev = null;
      }
      item.groupStart =
        item.kind !== "message" ||
        !prev ||
        prev.sender !== item.sender.userId ||
        item.ts - prev.ts > 5 * 60_000;
      items.push(item);
      prev = item.kind === "message" ? { sender: item.sender.userId, ts: item.ts } : null;
      if (readUpTo && ev.getId() === readUpTo) {
        items.push({ id: "read-marker", kind: "read-marker", sender: item.sender, ts: item.ts });
        prev = null;
      }
    };

    for (const ev of events) {
      const item = this.toItem(ev, myUserId);
      if (item) push(ev, item);
    }
    return items;
  }

  private toItem(ev: MatrixEvent, myUserId: string): TimelineItem | null {
    const type = ev.getType();
    const sender = this.senderOf(ev);
    const base = {
      id: ev.getId() ?? ev.getTxnId() ?? `local-${ev.getTs()}`,
      eventId: ev.getId() ?? undefined,
      sender,
      ts: ev.getTs(),
      isMine: ev.getSender() === myUserId,
    };

    if (ev.isRedacted()) {
      if (type !== EventType.RoomMessage && type !== EventType.RoomMessageEncrypted && type !== "m.sticker") return null;
      return { ...base, kind: "redacted" };
    }
    if (ev.isDecryptionFailure()) {
      return { ...base, kind: "encrypted-pending" };
    }
    if (ev.isBeingDecrypted() || type === EventType.RoomMessageEncrypted) {
      return { ...base, kind: "encrypted-pending" };
    }

    if (type === EventType.RoomMessage || type === "m.sticker") {
      const content = ev.getContent();
      // Edit events render through their target, not standalone.
      if (content["m.relates_to"]?.rel_type === "m.replace") return null;
      const body = this.toBody(content, type === "m.sticker");
      if (!body) return null;
      const status = ev.status;
      return {
        ...base,
        kind: "message",
        body,
        edited: !!ev.replacingEvent(),
        sendState:
          status === EventStatus.SENT || status === null
            ? status === null
              ? undefined
              : "sent"
            : status === EventStatus.NOT_SENT || status === EventStatus.CANCELLED
              ? "failed"
              : "sending",
        replyTo: this.replyContext(content),
        reactions: this.reactionsFor(ev),
        receipts: this.receiptsFor(ev, myUserId),
      };
    }

    if (RENDERED_STATE.has(type)) {
      const text = this.stateText(ev);
      if (!text) return null;
      return { ...base, kind: type === EventType.RoomMember ? "member" : "state", stateText: text };
    }
    return null;
  }

  private senderOf(ev: MatrixEvent): TimelineItem["sender"] {
    const userId = ev.getSender() ?? "";
    const member = this.room.getMember(userId);
    return {
      userId,
      name: member?.name ?? userId,
      avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
    };
  }

  private toBody(content: IContent, isSticker: boolean): MessageBody | null {
    const msgtype: string = isSticker ? "m.image" : (content.msgtype as string);
    const text = stripReplyFallbackText((content.body as string) ?? "");
    if (msgtype === "m.text" || msgtype === "m.notice" || msgtype === "m.emote") {
      let html: string | undefined;
      if (content.format === "org.matrix.custom.html" && typeof content.formatted_body === "string") {
        html = sanitizeIncomingHtml(stripReplyFallbackHtml(content.formatted_body));
      }
      return { msgtype, text, html };
    }
    const info = (content.info ?? {}) as Record<string, unknown>;
    const file = content.file as EncryptedFileInfo | undefined;
    const mxc = (file?.url ?? content.url) as string | undefined;
    if (!mxc) return null;
    if (msgtype === "m.image" || msgtype === "m.video") {
      const thumbFile = info.thumbnail_file as EncryptedFileInfo | undefined;
      return {
        msgtype,
        text: text || "attachment",
        mxc,
        file,
        thumbMxc: (thumbFile?.url ?? info.thumbnail_url) as string | undefined,
        thumbFile,
        w: info.w as number | undefined,
        h: info.h as number | undefined,
        mime: info.mimetype as string | undefined,
        size: info.size as number | undefined,
      };
    }
    if (msgtype === "m.file" || msgtype === "m.audio") {
      return {
        msgtype,
        text: text || "file",
        mxc,
        file,
        mime: info.mimetype as string | undefined,
        size: info.size as number | undefined,
      };
    }
    // Unknown msgtype: fall back to plain text rendering.
    return text ? { msgtype: "m.text", text } : null;
  }

  private replyContext(content: IContent): TimelineItem["replyTo"] {
    const replyId = content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
    if (!replyId) return undefined;
    const target = this.room.findEventById(replyId);
    if (!target) return { sender: "", preview: "…", eventId: replyId };
    const member = this.room.getMember(target.getSender() ?? "");
    const targetContent = target.getContent();
    const preview =
      target.isRedacted() || target.isDecryptionFailure()
        ? "…"
        : stripReplyFallbackText((targetContent.body as string) ?? "attachment");
    return {
      sender: member?.name ?? target.getSender() ?? "",
      preview: preview.slice(0, 200),
      eventId: replyId,
    };
  }

  private reactionsFor(ev: MatrixEvent): TimelineItem["reactions"] {
    const id = ev.getId();
    if (!id) return undefined;
    const rel = this.room
      .getUnfilteredTimelineSet()
      .relations.getChildEventsForEvent(id, "m.annotation", EventType.Reaction);
    const sorted = rel?.getSortedAnnotationsByKey();
    if (!sorted?.length) return undefined;
    const me = this.client.getUserId();
    const out = sorted
      .map(([key, evs]) => {
        const live = [...evs].filter((e) => !e.isRedacted());
        return {
          key,
          count: live.length,
          mine: live.some((e) => e.getSender() === me),
        };
      })
      .filter((r) => r.count > 0);
    return out.length ? out : undefined;
  }

  private receiptsFor(ev: MatrixEvent, myUserId: string): TimelineItem["receipts"] {
    const receipts = this.room.getReceiptsForEvent(ev);
    const out: NonNullable<TimelineItem["receipts"]> = [];
    for (const r of receipts) {
      if (r.type !== "m.read" || r.userId === myUserId || r.userId === ev.getSender()) continue;
      const member = this.room.getMember(r.userId);
      out.push({
        userId: r.userId,
        name: member?.name ?? r.userId,
        avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
      });
    }
    return out.length ? out.slice(0, 12) : undefined;
  }

  private stateText(ev: MatrixEvent): string | null {
    const senderName = this.senderOf(ev).name;
    const type = ev.getType();
    const content = ev.getContent();
    const prev = ev.getPrevContent();
    if (type === EventType.RoomMember) {
      const targetName = (content.displayname as string) ?? ev.getStateKey() ?? "";
      switch (content.membership) {
        case "join":
          if (prev.membership === "join") {
            if (prev.displayname !== content.displayname && content.displayname)
              return `${prev.displayname ?? targetName} is now known as ${content.displayname}`;
            if (prev.avatar_url !== content.avatar_url) return `${targetName} changed their avatar`;
            return null;
          }
          return `${targetName} joined`;
        case "leave":
          if (ev.getStateKey() === ev.getSender())
            return prev.membership === "invite" ? `${targetName} declined the invite` : `${targetName} left`;
          return `${senderName} removed ${(prev.displayname as string) ?? ev.getStateKey()}`;
        case "invite":
          return `${senderName} invited ${targetName}`;
        case "ban":
          return `${senderName} banned ${targetName}`;
        default:
          return null;
      }
    }
    if (type === EventType.RoomName) return content.name ? `${senderName} named the room "${content.name}"` : null;
    if (type === EventType.RoomTopic) return `${senderName} changed the topic`;
    if (type === EventType.RoomCreate) return `${senderName} created the room`;
    if (type === EventType.RoomEncryption) return "End-to-end encryption enabled";
    return null;
  }

  // ---- actions ----

  async sendText(text: string, replyToEventId?: string): Promise<void> {
    const html = markdownToMatrixHtml(text);
    const content: IContent = { msgtype: "m.text", body: text };
    if (html) {
      content.format = "org.matrix.custom.html";
      content.formatted_body = html;
    }
    if (replyToEventId) {
      const target = this.room.findEventById(replyToEventId);
      const fallbackName = target ? this.senderOf(target).name : "";
      const fallbackBody = target ? stripReplyFallbackText((target.getContent().body as string) ?? "") : "";
      content["m.relates_to"] = { "m.in_reply_to": { event_id: replyToEventId } };
      content.body = `> <${target?.getSender() ?? ""}> ${fallbackBody.split("\n")[0]}\n\n${text}`;
      content.format = "org.matrix.custom.html";
      content.formatted_body =
        `<mx-reply><blockquote>${escapeHtml(fallbackName)}: ${escapeHtml(fallbackBody.slice(0, 200))}</blockquote></mx-reply>` +
        (html ?? `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`);
    }
    try {
      await this.client.sendMessage(this.roomId, content as never);
    } catch (e) {
      throw toMaterixError(e, "send");
    }
  }

  async edit(eventId: string, newText: string): Promise<void> {
    const html = markdownToMatrixHtml(newText);
    const newContent: IContent = { msgtype: "m.text", body: newText };
    if (html) {
      newContent.format = "org.matrix.custom.html";
      newContent.formatted_body = html;
    }
    const content: IContent = {
      ...newContent,
      body: `* ${newText}`,
      "m.new_content": newContent,
      "m.relates_to": { rel_type: "m.replace", event_id: eventId },
    };
    await this.client.sendMessage(this.roomId, content as never);
  }

  async redact(eventId: string): Promise<void> {
    await this.client.redactEvent(this.roomId, eventId);
  }

  /** Toggle own reaction with the given key on an event. */
  async react(eventId: string, key: string): Promise<void> {
    const rel = this.room
      .getUnfilteredTimelineSet()
      .relations.getChildEventsForEvent(eventId, "m.annotation", EventType.Reaction);
    const mine = rel
      ?.getRelations()
      .find((e) => e.getSender() === this.client.getUserId() && e.getContent()["m.relates_to"]?.key === key && !e.isRedacted());
    if (mine?.getId()) {
      await this.client.redactEvent(this.roomId, mine.getId()!);
      return;
    }
    await this.client.sendEvent(this.roomId, EventType.Reaction as never, {
      "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key },
    } as never);
  }

  async sendFile(file: File, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const mime = file.type || "application/octet-stream";
    const msgtype = mime.startsWith("image/")
      ? "m.image"
      : mime.startsWith("video/")
        ? "m.video"
        : mime.startsWith("audio/")
          ? "m.audio"
          : "m.file";
    const info: Record<string, unknown> = { mimetype: mime, size: file.size };
    if (msgtype === "m.image") {
      try {
        const bmp = await createImageBitmap(file);
        info.w = bmp.width;
        info.h = bmp.height;
        bmp.close();
      } catch {
        // dimensions are optional
      }
    }
    const content: IContent = { msgtype, body: file.name, info };
    const progress = onProgress
      ? { progressHandler: (p: { loaded: number; total: number }) => onProgress(p.loaded, p.total) }
      : {};
    try {
      if (this.room.hasEncryptionStateEvent()) {
        const encrypted = await encryptAttachment(await file.arrayBuffer());
        const upload = await this.client.uploadContent(new Blob([encrypted.data]), {
          type: "application/octet-stream",
          ...progress,
        });
        content.file = { ...encrypted.info, url: upload.content_uri, mimetype: mime };
      } else {
        const upload = await this.client.uploadContent(file, { type: mime, ...progress });
        content.url = upload.content_uri;
      }
      await this.client.sendMessage(this.roomId, content as never);
    } catch (e) {
      throw toMaterixError(e, "send");
    }
  }

  async resend(localId: string): Promise<void> {
    const ev = this.room
      .getLiveTimeline()
      .getEvents()
      .find((e) => (e.getId() ?? e.getTxnId()) === localId);
    if (ev) await this.client.resendEvent(ev, this.room);
  }

  /** Mark the room read up to its latest event. */
  async markRead(): Promise<void> {
    const events = this.room.getLiveTimeline().getEvents();
    const last = [...events].reverse().find((e) => !!e.getId());
    if (!last) return;
    await this.client.sendReadReceipt(last);
    await this.client.setRoomReadMarkers(this.roomId, last.getId()!, last);
  }

  async setTyping(typing: boolean): Promise<void> {
    try {
      await this.client.sendTyping(this.roomId, typing, 10_000);
    } catch {
      // typing is best-effort
    }
  }

  /** Load older history; resolves false when the start of the room is reached. */
  async paginateBack(limit = 40): Promise<boolean> {
    const tl = this.room.getLiveTimeline();
    if (!tl.getPaginationToken(Direction.Backward)) return false;
    return this.client.paginateEventTimeline(tl, { backwards: true, limit });
  }

  canPaginateBack(): boolean {
    return !!this.room.getLiveTimeline().getPaginationToken(Direction.Backward);
  }

  details(): RoomDetails {
    const me = this.client.getUserId()!;
    const pl = this.room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ?? {};
    const users = (pl.users ?? {}) as Record<string, number>;
    const myPl = users[me] ?? ((pl.users_default as number) ?? 0);
    const inviteLevel = (pl.invite as number) ?? 0;
    const kickLevel = (pl.kick as number) ?? 50;
    const redactLevel = (pl.redact as number) ?? 50;
    return {
      roomId: this.roomId,
      name: this.room.name,
      topic: (this.room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent().topic as string) ?? undefined,
      avatarUrl: this.room.getMxcAvatarUrl() ?? undefined,
      canonicalAlias: this.room.getCanonicalAlias() ?? undefined,
      isEncrypted: this.room.hasEncryptionStateEvent(),
      isDirect: !!this.client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>(),
      memberCount: this.room.getJoinedMemberCount(),
      myPowerLevel: myPl,
      canInvite: myPl >= inviteLevel,
      canKick: myPl >= kickLevel,
      canRedactOthers: myPl >= redactLevel,
    };
  }

  members(): MemberSummary[] {
    const pl = this.room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ?? {};
    const users = (pl.users ?? {}) as Record<string, number>;
    return this.room
      .getJoinedMembers()
      .map((m) => ({
        userId: m.userId,
        name: m.name,
        avatarUrl: m.getMxcAvatarUrl() ?? undefined,
        powerLevel: users[m.userId] ?? ((pl.users_default as number) ?? 0),
        membership: m.membership ?? "join",
      }))
      .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name));
  }

  typingNames(): string[] {
    const me = this.client.getUserId();
    return this.room
      .getMembers()
      .filter((m) => m.typing && m.userId !== me)
      .map((m) => m.name);
  }

  async invite(userId: string): Promise<void> {
    try {
      await this.client.invite(this.roomId, userId);
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  async kick(userId: string, reason?: string): Promise<void> {
    try {
      await this.client.kick(this.roomId, userId, reason);
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  async leave(): Promise<void> {
    try {
      await this.client.leave(this.roomId);
    } catch (e) {
      throw toMaterixError(e);
    }
  }
}
