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
import { parseBeaconContent } from "matrix-js-sdk/lib/content-helpers";
import type {
  EncryptedFileInfo,
  LiveBeacon,
  MediaItem,
  MemberSummary,
  MessageBody,
  PollData,
  RoomDetails,
  ThreadSummary,
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

// MSC3381 poll event types (stable + unstable prefixes).
const POLL_START = ["m.poll.start", "org.matrix.msc3381.poll.start"];
const POLL_RESPONSE = ["m.poll.response", "org.matrix.msc3381.poll.response"];
const POLL_END = ["m.poll.end", "org.matrix.msc3381.poll.end"];

function pollContent(ev: MatrixEvent): Record<string, unknown> | undefined {
  const c = ev.getContent();
  return (c["m.poll.start"] ?? c["org.matrix.msc3381.poll.start"] ?? (c.question ? c : undefined)) as
    | Record<string, unknown>
    | undefined;
}

const RENDERED_STATE = new Set<string>([
  EventType.RoomMember,
  EventType.RoomName,
  EventType.RoomTopic,
  EventType.RoomCreate,
  EventType.RoomEncryption,
]);

export class RoomHandle {
  /** Read-marker position frozen when the room was opened, so it doesn't
   * vanish the moment we send the read receipt. */
  private frozenMarker: string | null = null;

  constructor(
    private client: MatrixClient,
    private room: Room,
  ) {}

  get roomId(): string {
    return this.room.roomId;
  }

  /** Capture the current read position; call when the user opens the room. */
  snapshotReadMarker(): void {
    const myUserId = this.client.getUserId()!;
    const events = this.room.getLiveTimeline().getEvents();
    let readUpTo = this.room.getEventReadUpTo(myUserId, false);
    if (readUpTo) {
      const idx = events.findIndex((e) => e.getId() === readUpTo);
      // Marker is pointless when nothing follows it, or only our own sends do.
      if (idx === -1 || idx === events.length - 1 || events.slice(idx + 1).every((e) => e.getSender() === myUserId)) {
        readUpTo = null;
      }
    }
    this.frozenMarker = readUpTo;
  }

  /** Build the renderable timeline snapshot (oldest first). */
  timeline(): TimelineItem[] {
    const myUserId = this.client.getUserId()!;
    const events = this.room.getLiveTimeline().getEvents();
    const readUpTo = this.frozenMarker;
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
      // Verification requests are handled by the verification dialog, not
      // rendered as chat text (their fallback body is confusing).
      if (content.msgtype === "m.key.verification.request") {
        return {
          ...base,
          kind: "state",
          stateText: `${sender.name} sent a verification request`,
        };
      }
      const body = this.toBody(content, type === "m.sticker");
      if (!body) return null;
      const status = ev.status;
      // A message that is itself a thread root carries a reply count so the
      // main timeline can show a "N replies" affordance.
      const thread = base.eventId ? this.room.getThread(base.eventId) : null;
      const threadReplyCount = thread && thread.length > 0 ? thread.length : undefined;
      return {
        ...base,
        kind: "message",
        body,
        threadReplyCount,
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

    if (POLL_START.includes(type)) {
      const poll = this.buildPoll(ev, myUserId);
      if (!poll) return null;
      return { ...base, kind: "poll", poll, reactions: this.reactionsFor(ev), receipts: this.receiptsFor(ev, myUserId) };
    }

    if (RENDERED_STATE.has(type)) {
      const text = this.stateText(ev);
      if (!text) return null;
      return { ...base, kind: type === EventType.RoomMember ? "member" : "state", stateText: text };
    }
    return null;
  }

  private buildPoll(ev: MatrixEvent, myUserId: string): PollData | null {
    const start = pollContent(ev);
    if (!start) return null;
    const id = ev.getId();
    if (!id) return null;
    const question =
      ((start["m.text"] as string) ??
        (start.question as { "m.text"?: string; body?: string })?.["m.text"] ??
        (start.question as { body?: string })?.body ??
        "Poll") as string;
    const kind = ((start.kind as string) ?? "").includes("undisclosed") ? "undisclosed" : "disclosed";
    const maxSelections = Math.max(1, (start.max_selections as number) ?? 1);
    const rawAnswers = (start.answers as { id: string; "m.text"?: string; answer?: { "m.text"?: string } }[]) ?? [];
    const answers = rawAnswers.map((a) => ({
      id: a.id,
      text: (a["m.text"] ?? a.answer?.["m.text"] ?? a.id) as string,
      votes: 0,
      chosenByMe: false,
    }));
    const validIds = new Set(answers.map((a) => a.id));

    // Aggregate: latest response per sender (relations), ignore after poll end.
    const timelineSet = this.room.getUnfilteredTimelineSet();
    const ended = POLL_END.some(
      (t) => (timelineSet.relations.getChildEventsForEvent(id, "m.reference", t)?.getRelations().length ?? 0) > 0,
    );
    const latestBySender = new Map<string, { ts: number; ids: string[] }>();
    for (const relType of POLL_RESPONSE) {
      const rel = timelineSet.relations.getChildEventsForEvent(id, "m.reference", relType);
      for (const r of rel?.getRelations() ?? []) {
        const sender = r.getSender();
        if (!sender || r.isRedacted()) continue;
        const resp = (r.getContent()["m.poll.response"] ?? r.getContent()["org.matrix.msc3381.poll.response"]) as
          | { answers?: string[] }
          | undefined;
        const picks = (resp?.answers ?? []).filter((a) => validIds.has(a)).slice(0, maxSelections);
        const prev = latestBySender.get(sender);
        if (!prev || r.getTs() > prev.ts) latestBySender.set(sender, { ts: r.getTs(), ids: picks });
      }
    }
    let total = 0;
    for (const [sender, { ids }] of latestBySender) {
      for (const pick of ids) {
        const ans = answers.find((a) => a.id === pick);
        if (!ans) continue;
        ans.votes++;
        total++;
        if (sender === myUserId) ans.chosenByMe = true;
      }
    }
    return { eventId: id, question, kind, maxSelections, ended, answers, totalVotes: total };
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
    if (msgtype === "m.location" || content.geo_uri) {
      const geoUri = (content.geo_uri as string) ?? "";
      const coords = /geo:([-\d.]+),([-\d.]+)/.exec(geoUri);
      return {
        msgtype: "m.location",
        text: text || "Location",
        geoUri,
        lat: coords ? parseFloat(coords[1]) : undefined,
        lon: coords ? parseFloat(coords[2]) : undefined,
      };
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
    if (msgtype === "m.audio") {
      const voice = "org.matrix.msc3245.voice" in content;
      const audioMeta = (content["org.matrix.msc1767.audio"] ?? {}) as { duration?: number; waveform?: number[] };
      return {
        msgtype: "m.audio",
        text: text || "audio",
        mxc,
        file,
        mime: info.mimetype as string | undefined,
        size: info.size as number | undefined,
        voice,
        durationMs: audioMeta.duration ?? (info.duration as number | undefined),
        waveform: audioMeta.waveform,
      };
    }
    if (msgtype === "m.file") {
      return {
        msgtype: "m.file",
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

  /** One-line preview of an event's body, redaction/decryption-aware. */
  private previewOf(ev: MatrixEvent): string {
    if (ev.isRedacted() || ev.isDecryptionFailure()) return "…";
    const body = stripReplyFallbackText((ev.getContent().body as string) ?? "attachment");
    return (body.split("\n")[0] || "attachment").slice(0, 140);
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

  // ---- threads ----

  /** All threads in the room, newest activity first. */
  threads(): ThreadSummary[] {
    const out: ThreadSummary[] = [];
    for (const thread of this.room.getThreads()) {
      const root = thread.rootEvent;
      if (!root) continue;
      const latest = thread.replyToEvent ?? thread.lastReply() ?? root;
      out.push({
        rootEventId: thread.id,
        rootSenderName: this.senderOf(root).name,
        rootPreview: this.previewOf(root),
        replyCount: thread.length,
        latestTs: latest.getTs(),
        latestPreview: this.previewOf(latest),
      });
    }
    return out.sort((a, b) => b.latestTs - a.latestTs);
  }

  /** Renderable items for one thread: the root followed by its replies. */
  threadItems(rootEventId: string): TimelineItem[] {
    const myUserId = this.client.getUserId()!;
    const thread = this.room.getThread(rootEventId);
    if (!thread) return [];
    const events = thread.timeline;
    // The SDK usually seeds the root into the thread timeline, but not always;
    // make sure it is present at the top.
    const ordered =
      events.some((e) => e.getId() === rootEventId) || !thread.rootEvent ? events : [thread.rootEvent, ...events];

    const items: TimelineItem[] = [];
    let prev: { sender: string; ts: number } | null = null;
    for (const ev of ordered) {
      const item = this.toItem(ev, myUserId);
      if (!item) continue;
      // Mirror the main timeline's same-sender grouping so avatars/names render.
      item.groupStart =
        item.kind !== "message" || !prev || prev.sender !== item.sender.userId || item.ts - prev.ts > 5 * 60_000;
      items.push(item);
      prev = item.kind === "message" ? { sender: item.sender.userId, ts: item.ts } : null;
    }
    return items;
  }

  /** Send a threaded reply to the given thread root (Markdown-aware). */
  async sendThreadReply(rootEventId: string, text: string): Promise<void> {
    const html = markdownToMatrixHtml(text);
    const content: IContent = { msgtype: "m.text", body: text };
    if (html) {
      content.format = "org.matrix.custom.html";
      content.formatted_body = html;
    }
    // Fall back to the latest known reply so non-threaded clients render a
    // sensible reply chain; the root itself if the thread has no replies yet.
    const thread = this.room.getThread(rootEventId);
    const latestId = thread?.replyToEvent?.getId() ?? thread?.lastReply()?.getId() ?? rootEventId;
    content["m.relates_to"] = {
      rel_type: "m.thread",
      event_id: rootEventId,
      is_falling_back: true,
      "m.in_reply_to": { event_id: latestId },
    };
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

  /**
   * Build a cleaned copy of an event's content suitable for re-sending into
   * another room. Keeps only the message-shaping fields and STRIPS
   * `m.relates_to`, so a forward never carries a reply/edit/thread relation.
   * For encrypted media the `file` block (with its per-file key) is reused
   * verbatim — the target room re-encrypts the whole event, so that key stays
   * protected. Returns null when the event is missing or not a forwardable
   * message (redacted, undecryptable, a poll/state event, or a verification
   * request).
   */
  contentForForward(eventId: string): IContent | null {
    const ev = this.room.findEventById(eventId);
    if (!ev) return null;
    const type = ev.getType();
    if (type !== EventType.RoomMessage && type !== "m.sticker") return null;
    if (ev.isRedacted() || ev.isDecryptionFailure() || ev.isBeingDecrypted()) return null;
    const content = ev.getContent();
    if (content.msgtype === "m.key.verification.request") return null;

    const out: IContent = {};
    for (const key of ["msgtype", "body", "formatted_body", "format", "url", "file", "info", "filename"] as const) {
      if (content[key] !== undefined) out[key] = content[key];
    }
    // Stickers carry no msgtype; forward them as images so the target room
    // (which receives an m.room.message) renders them.
    if (out.msgtype === undefined) {
      if (type === "m.sticker") out.msgtype = "m.image";
      else return null;
    }
    // A message with neither text body nor media is nothing to forward.
    if (out.body === undefined && out.url === undefined && out.file === undefined) return null;
    return out;
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

  /** Cast (or change) a vote on a poll. Empty selection is allowed by spec. */
  async votePoll(pollEventId: string, answerIds: string[]): Promise<void> {
    try {
      await this.client.sendEvent(this.roomId, "m.poll.response" as never, {
        "m.relates_to": { rel_type: "m.reference", event_id: pollEventId },
        "m.poll.response": { answers: answerIds },
      } as never);
    } catch (e) {
      throw toMaterixError(e, "send");
    }
  }

  async endPoll(pollEventId: string): Promise<void> {
    await this.client.sendEvent(this.roomId, "m.poll.end" as never, {
      "m.relates_to": { rel_type: "m.reference", event_id: pollEventId },
      "m.poll.end": {},
      "m.text": "The poll has ended.",
    } as never);
  }

  async createPoll(question: string, answers: string[], multiple: boolean): Promise<void> {
    const content = {
      "m.poll.start": {
        kind: "org.matrix.msc3381.poll.disclosed",
        max_selections: multiple ? answers.length : 1,
        question: { "m.text": question },
        answers: answers.map((text, i) => ({ id: `opt${i}`, "m.text": text })),
      },
      "m.text": `${question}\n${answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    };
    try {
      await this.client.sendEvent(this.roomId, "m.poll.start" as never, content as never);
    } catch (e) {
      throw toMaterixError(e, "send");
    }
  }

  /** Share a static location as an m.location event. */
  async sendLocation(lat: number, lon: number, description?: string): Promise<void> {
    const geoUri = `geo:${lat},${lon}`;
    try {
      await this.client.sendEvent(this.roomId, EventType.RoomMessage as never, {
        msgtype: "m.location",
        body: description || `Location: ${lat}, ${lon}`,
        geo_uri: geoUri,
        "org.matrix.msc3488.location": { uri: geoUri, description },
        "org.matrix.msc3488.asset": { type: "m.pin" },
      } as never);
    } catch (e) {
      throw toMaterixError(e, "send");
    }
  }

  /**
   * Start sharing live location for `durationMs`. Returns a stop() function.
   * Creates an m.beacon_info state event (live=true), then streams m.beacon
   * location updates from the device geolocation until stopped or expired.
   */
  async startLiveLocation(durationMs: number): Promise<() => Promise<void>> {
    const { makeBeaconInfoContent, makeBeaconContent } = await import("matrix-js-sdk/lib/content-helpers");
    const infoContent = makeBeaconInfoContent(durationMs, true, "Live location", "m.self" as never);
    let res;
    try {
      res = await this.client.unstable_createLiveBeacon(this.roomId, infoContent as never);
    } catch (e) {
      throw toMaterixError(e, "send");
    }
    const beaconInfoId = res.event_id;

    let stopped = false;
    const push = (pos: GeolocationPosition) => {
      if (stopped) return;
      const geoUri = `geo:${pos.coords.latitude},${pos.coords.longitude};u=${Math.round(pos.coords.accuracy)}`;
      const content = makeBeaconContent(geoUri, Math.floor(pos.timestamp || Date.now()), beaconInfoId);
      this.client.sendEvent(this.roomId, "org.matrix.msc3672.beacon" as never, content as never).catch(() => undefined);
    };
    navigator.geolocation.getCurrentPosition(push, () => undefined, { enableHighAccuracy: true });
    const watchId = navigator.geolocation.watchPosition(push, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 5000,
    });

    const stop = async () => {
      if (stopped) return;
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(expiry);
      const offContent = makeBeaconInfoContent(durationMs, false, "Live location", "m.self" as never);
      await this.client.unstable_setLiveBeacon(this.roomId, offContent as never).catch(() => undefined);
    };
    const expiry = setTimeout(() => void stop(), durationMs);
    return stop;
  }

  /** Turn off all of my live beacons in this room (any device). */
  async stopMyLiveLocation(): Promise<void> {
    const me = this.client.getUserId();
    const { makeBeaconInfoContent } = await import("matrix-js-sdk/lib/content-helpers");
    for (const beacon of this.room.currentState.beacons.values()) {
      if (beacon.beaconInfoOwner !== me || !beacon.isLive) continue;
      const info = beacon.beaconInfo;
      const off = makeBeaconInfoContent(info.timeout ?? 0, false, info.description, "m.self" as never);
      await this.client.unstable_setLiveBeacon(this.roomId, off as never).catch(() => undefined);
    }
  }

  async sendFile(
    file: File,
    onProgress?: (loaded: number, total: number) => void,
    opts?: { caption?: string },
  ): Promise<void> {
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
    // A caption becomes the body; the original filename is preserved separately
    // (MSC2530-style) so it still downloads with a sensible name.
    const caption = opts?.caption?.trim();
    const content: IContent = caption
      ? { msgtype, body: caption, filename: file.name, info }
      : { msgtype, body: file.name, info };
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

  /** Send an MSC3245 voice message (m.audio + voice/waveform metadata). */
  async sendVoiceMessage(file: File, durationMs: number, waveform: number[]): Promise<void> {
    const mime = file.type || "audio/ogg";
    const info = { mimetype: mime, size: file.size, duration: durationMs };
    const content: IContent = {
      msgtype: "m.audio",
      body: "Voice message",
      info,
      "org.matrix.msc3245.voice": {},
      "org.matrix.msc1767.audio": { duration: durationMs, waveform },
    };
    try {
      if (this.room.hasEncryptionStateEvent()) {
        const encrypted = await encryptAttachment(await file.arrayBuffer());
        const upload = await this.client.uploadContent(new Blob([encrypted.data]), { type: "application/octet-stream" });
        content.file = { ...encrypted.info, url: upload.content_uri, mimetype: mime };
      } else {
        const upload = await this.client.uploadContent(file, { type: mime });
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

  /** Collect image/video (and optionally file) events from loaded history. */
  media(kinds: ("image" | "video" | "file")[] = ["image", "video"]): MediaItem[] {
    const want = new Set(kinds);
    const out: MediaItem[] = [];
    for (const ev of this.room.getLiveTimeline().getEvents()) {
      if (ev.getType() !== EventType.RoomMessage || ev.isRedacted()) continue;
      const content = ev.getContent();
      const msgtype = content.msgtype as string;
      const kind = msgtype === "m.image" ? "image" : msgtype === "m.video" ? "video" : msgtype === "m.file" ? "file" : null;
      if (!kind || !want.has(kind)) continue;
      const info = (content.info ?? {}) as Record<string, unknown>;
      const file = content.file as EncryptedFileInfo | undefined;
      const mxc = (file?.url ?? content.url) as string | undefined;
      if (!mxc) continue;
      const thumbFile = info.thumbnail_file as EncryptedFileInfo | undefined;
      const member = this.room.getMember(ev.getSender() ?? "");
      out.push({
        eventId: ev.getId() ?? `${ev.getTs()}`,
        kind,
        ts: ev.getTs(),
        senderName: ev.getSender() === this.client.getUserId() ? "You" : (member?.name ?? ev.getSender() ?? ""),
        text: (content.body as string) ?? "",
        mxc,
        file,
        thumbMxc: (thumbFile?.url ?? info.thumbnail_url) as string | undefined,
        thumbFile,
        mime: info.mimetype as string | undefined,
        size: info.size as number | undefined,
        w: info.w as number | undefined,
        h: info.h as number | undefined,
      });
    }
    return out.reverse(); // newest first
  }

  /** Currently-live location beacons in this room (yours and others'). */
  liveBeacons(): LiveBeacon[] {
    const me = this.client.getUserId();
    const out: LiveBeacon[] = [];
    for (const beacon of this.room.currentState.beacons.values()) {
      if (!beacon.isLive) continue;
      const info = beacon.beaconInfo;
      const owner = beacon.beaconInfoOwner;
      const member = this.room.getMember(owner);
      let lat: number | undefined;
      let lon: number | undefined;
      let accuracy: number | undefined;
      const loc = beacon.latestLocationState;
      if (loc?.uri) {
        const parsed = parseBeaconContent({ "org.matrix.msc3672.beacon": { "m.location": { uri: loc.uri } } } as never);
        const uri = parsed.uri ?? loc.uri;
        const m = /geo:([-\d.]+),([-\d.]+)(?:;u=([\d.]+))?/.exec(uri);
        if (m) {
          lat = parseFloat(m[1]);
          lon = parseFloat(m[2]);
          accuracy = m[3] ? parseFloat(m[3]) : undefined;
        }
      }
      const startTs = info.timestamp ?? beacon.beaconInfo.timestamp ?? Date.now();
      out.push({
        id: beacon.identifier,
        owner: { userId: owner, name: member?.name ?? owner, avatarUrl: member?.getMxcAvatarUrl() ?? undefined },
        mine: owner === me,
        description: info.description,
        lat,
        lon,
        accuracy,
        updatedTs: loc?.timestamp,
        expiresTs: startTs + (info.timeout ?? 0),
      });
    }
    return out.sort((a, b) => Number(b.mine) - Number(a.mine) || (b.updatedTs ?? 0) - (a.updatedTs ?? 0));
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
