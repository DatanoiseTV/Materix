// One logged-in account: owns a MatrixClient, exposes UI-facing snapshots and
// actions. Contract: docs/api-contract.md "Core boundary".

import {
  ClientEvent,
  EventType,
  IndexedDBStore,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  SyncState,
  createClient,
  type MatrixClient,
  type Room,
} from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent";
import type {
  AccountInfo,
  AccountKey,
  CreateRoomOpts,
  PublicRoomResult,
  PublicRoomsPage,
  RoomSummary,
  SessionData,
  SyncStateName,
  UserSearchResult,
} from "./types";
import { RoomHandle } from "./roomHandle";
import { previewText } from "./markdown";
import { CryptoFacade, cryptoCallbacks } from "./crypto";
import { Emitter } from "./emitter";
import { toMaterixError } from "./errors";

/** Deterministic per-account accent color. */
function accountColor(key: AccountKey): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 52%)`;
}

export class MatrixAccount {
  readonly events = new Emitter<string>(); // "rooms" | "self" | `room:${roomId}`
  readonly crypto: CryptoFacade;
  client!: MatrixClient;
  syncState: SyncStateName = "initial";
  startError?: string;
  private handles = new Map<string, RoomHandle>();
  private directRooms = new Set<string>();
  /** Client-side per-room settings, synced via io.materix.settings account data. */
  private roomSettings: Record<string, { archived?: boolean; mutedUntil?: number }> = {};

  constructor(
    readonly key: AccountKey,
    readonly session: SessionData,
  ) {
    this.crypto = new CryptoFacade(key);
  }

  async start(): Promise<void> {
    const store = new IndexedDBStore({
      indexedDB: window.indexedDB,
      dbName: `materix-sync-${this.key}`,
    });
    this.client = createClient({
      baseUrl: this.session.homeserverUrl,
      accessToken: this.session.accessToken,
      refreshToken: this.session.refreshToken,
      userId: this.session.userId,
      deviceId: this.session.deviceId,
      store,
      timelineSupport: true,
      cryptoCallbacks,
    });
    this.crypto.bind(this.client);
    // Must run after the store is assigned to the client (SDK requirement).
    await store.startup();

    try {
      await this.client.initRustCrypto({ cryptoDatabasePrefix: `materix-crypto-${this.key}` });
      this.crypto.attach();
    } catch (e) {
      // Crypto store corruption must not brick the account; run unencrypted-capable.
      console.error(`rust crypto init failed for ${this.session.userId}`, e);
    }

    this.wireListeners();
    await this.client.startClient({ initialSyncLimit: 20 });
  }

  private wireListeners(): void {
    const c = this.client;
    const bumpRooms = () => this.events.emit("rooms");
    const bumpRoom = (room?: Room | null) => {
      if (room) this.events.emit(`room:${room.roomId}`);
      this.events.emit("rooms");
    };

    c.on(ClientEvent.Sync, (state) => {
      const prev = this.syncState;
      this.syncState =
        state === SyncState.Prepared || state === SyncState.Syncing
          ? "ready"
          : state === SyncState.Error || state === SyncState.Reconnecting
            ? "error"
            : state === SyncState.Stopped
              ? "stopped"
              : "syncing";
      if (prev !== this.syncState) this.events.emit("self");
      bumpRooms();
    });
    c.on(RoomEvent.Timeline, (_ev, room) => bumpRoom(room));
    c.on(RoomEvent.LocalEchoUpdated, (_ev, room) => bumpRoom(room));
    c.on(RoomEvent.Receipt, (_ev, room) => bumpRoom(room));
    c.on(RoomEvent.Redaction, (_ev, room) => bumpRoom(room));
    c.on(RoomEvent.Name, () => bumpRooms());
    c.on(RoomEvent.MyMembership, () => bumpRooms());
    c.on(RoomEvent.Tags, () => bumpRooms());
    c.on(RoomMemberEvent.Typing, (_ev, member) => bumpRoom(c.getRoom(member.roomId)));
    c.on(RoomStateEvent.Events, (ev) => bumpRoom(c.getRoom(ev.getRoomId() ?? undefined)));
    c.on(MatrixEventEvent.Decrypted, (ev) => bumpRoom(c.getRoom(ev.getRoomId() ?? undefined)));
    c.on(ClientEvent.AccountData, (ev) => {
      if (ev.getType() === EventType.Direct) {
        this.rebuildDirectSet();
        bumpRooms();
      }
      if (ev.getType() === "io.materix.settings") {
        this.loadRoomSettings();
        bumpRooms();
      }
    });
    this.loadRoomSettings();
    c.on(CryptoEvent.VerificationRequestReceived as never, (() => this.events.emit("self")) as never);
    this.rebuildDirectSet();
  }

  private loadRoomSettings(): void {
    const content = this.client
      .getAccountData("io.materix.settings" as never)
      ?.getContent<{ rooms?: Record<string, { archived?: boolean; mutedUntil?: number }> }>();
    this.roomSettings = content?.rooms ?? {};
  }

  private async saveRoomSettings(roomId: string, patch: { archived?: boolean; mutedUntil?: number }): Promise<void> {
    const next = { ...this.roomSettings };
    const entry = { ...next[roomId], ...patch };
    // Drop no-op/default entries to keep the account-data blob small.
    if (!entry.archived && (!entry.mutedUntil || entry.mutedUntil < Date.now())) delete next[roomId];
    else next[roomId] = entry;
    this.roomSettings = next;
    await this.client.setAccountData("io.materix.settings" as never, { rooms: next } as never);
    this.events.emit("rooms");
  }

  async setArchived(roomId: string, archived: boolean): Promise<void> {
    await this.saveRoomSettings(roomId, { archived });
  }

  isMuted(roomId: string): boolean {
    const until = this.roomSettings[roomId]?.mutedUntil ?? 0;
    return until > Date.now();
  }

  /** durationMs: undefined/0 unmutes, Infinity mutes forever. */
  async setMuted(roomId: string, durationMs: number | undefined): Promise<void> {
    const mutedUntil = !durationMs ? 0 : durationMs === Infinity ? Number.MAX_SAFE_INTEGER : Date.now() + durationMs;
    await this.saveRoomSettings(roomId, { mutedUntil });
  }

  private rebuildDirectSet(): void {
    this.directRooms.clear();
    const direct = this.client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
    for (const roomIds of Object.values(direct)) {
      for (const id of roomIds) this.directRooms.add(id);
    }
  }

  info(): AccountInfo {
    const me = this.session.userId;
    const user = this.client?.getUser(me);
    return {
      key: this.key,
      userId: me,
      displayName: user?.displayName ?? me.split(":")[0].slice(1),
      avatarUrl: user?.avatarUrl ?? undefined,
      homeserverName: me.split(":").slice(1).join(":"),
      color: accountColor(this.key),
      syncState: this.syncState,
    };
  }

  rooms(): RoomSummary[] {
    if (!this.client) return [];
    return this.client
      .getVisibleRooms()
      .filter((r) => {
        const m = r.getMyMembership();
        return m === "join" || m === "invite";
      })
      .map((r) => this.summarize(r));
  }

  private summarize(room: Room): RoomSummary {
    const isInvite = room.getMyMembership() === "invite";
    const tags = room.tags ?? {};
    const last = this.lastPreview(room);
    const settings = this.roomSettings[room.roomId] ?? {};
    const mutedUntil = settings.mutedUntil && settings.mutedUntil > Date.now() ? settings.mutedUntil : 0;
    const inviter = isInvite
      ? room.getMember(this.session.userId)?.events.member?.getSender()
      : undefined;
    return {
      accountKey: this.key,
      roomId: room.roomId,
      name: room.name || "Unnamed room",
      avatarUrl: room.getMxcAvatarUrl() ?? this.dmPartnerAvatar(room),
      isDirect: this.directRooms.has(room.roomId) || !!room.getDMInviter(),
      isEncrypted: room.hasEncryptionStateEvent(),
      isFavorite: "m.favourite" in tags,
      isLowPriority: "m.lowpriority" in tags,
      isArchived: !!settings.archived && !isInvite,
      mutedUntil,
      isInvite,
      inviterName: inviter ? (room.getMember(inviter)?.name ?? inviter) : undefined,
      isSpace: room.isSpaceRoom(),
      unreadCount: room.getUnreadNotificationCount() ?? 0,
      highlightCount: room.getUnreadNotificationCount("highlight" as never) ?? 0,
      lastActivityTs: room.getLastActiveTimestamp(),
      lastEvent: last,
      typing: this.room(room.roomId).typingNames(),
    };
  }

  private dmPartnerAvatar(room: Room): string | undefined {
    if (!this.directRooms.has(room.roomId)) return undefined;
    const other = room.getJoinedMembers().find((m) => m.userId !== this.session.userId);
    return other?.getMxcAvatarUrl() ?? undefined;
  }

  private lastPreview(room: Room): RoomSummary["lastEvent"] {
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      const type = ev.getType();
      if (type === "m.poll.start" || type === "org.matrix.msc3381.poll.start") {
        const member = room.getMember(ev.getSender() ?? "");
        return {
          ts: ev.getTs(),
          senderName: ev.getSender() === this.session.userId ? "You" : (member?.name ?? ev.getSender() ?? ""),
          preview: "Poll",
        };
      }
      if (type !== EventType.RoomMessage && type !== EventType.RoomMessageEncrypted && type !== "m.sticker") continue;
      const member = room.getMember(ev.getSender() ?? "");
      const senderName =
        ev.getSender() === this.session.userId ? "You" : (member?.name ?? ev.getSender() ?? "");
      let preview: string;
      if (ev.isRedacted()) preview = "Message deleted";
      else if (ev.isDecryptionFailure() || ev.isBeingDecrypted() || type === EventType.RoomMessageEncrypted)
        preview = "Encrypted message";
      else {
        const content = ev.getContent();
        if (content["m.relates_to"]?.rel_type === "m.replace") continue;
        const msgtype = content.msgtype as string;
        preview =
          msgtype === "m.image"
            ? "Photo"
            : msgtype === "m.video"
              ? "Video"
              : msgtype === "m.audio"
                ? content["org.matrix.msc3245.voice"]
                  ? "Voice message"
                  : "Audio"
                : msgtype === "m.file"
                  ? "File"
                  : msgtype === "m.location"
                    ? "Location"
                    : msgtype === "m.key.verification.request"
                      ? "Verification request"
                      : previewText((content.body as string) ?? "");
      }
      return { ts: ev.getTs(), senderName, preview: preview.slice(0, 120) };
    }
    return undefined;
  }

  room(roomId: string): RoomHandle {
    let h = this.handles.get(roomId);
    if (!h) {
      const room = this.client.getRoom(roomId);
      if (!room) throw new Error(`unknown room ${roomId}`);
      h = new RoomHandle(this.client, room);
      this.handles.set(roomId, h);
    }
    return h;
  }

  async createRoom(opts: CreateRoomOpts): Promise<string> {
    const initialState = [];
    if (opts.encrypted !== false && !opts.public) {
      initialState.push({
        type: EventType.RoomEncryption,
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      });
    }
    try {
      const res = await this.client.createRoom({
        name: opts.name,
        topic: opts.topic,
        invite: opts.invite,
        is_direct: opts.direct,
        visibility: (opts.public ? "public" : "private") as never,
        preset: (opts.public ? "public_chat" : "private_chat") as never,
        initial_state: initialState as never,
      });
      if (opts.direct && opts.invite?.length === 1) {
        await this.addToDirects(opts.invite[0], res.room_id);
      }
      return res.room_id;
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  async startDm(userId: string): Promise<string> {
    // Reuse an existing DM with this user when one is still joined.
    const direct = this.client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
    for (const roomId of direct[userId] ?? []) {
      const room = this.client.getRoom(roomId);
      if (room && room.getMyMembership() === "join") return roomId;
    }
    return this.createRoom({ direct: true, invite: [userId], encrypted: true });
  }

  private async addToDirects(userId: string, roomId: string): Promise<void> {
    const direct = this.client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
    const next = { ...direct, [userId]: [...new Set([...(direct[userId] ?? []), roomId])] };
    await this.client.setAccountData(EventType.Direct, next as never);
  }

  async joinRoom(idOrAlias: string): Promise<string> {
    try {
      const room = await this.client.joinRoom(idOrAlias.trim());
      return room.roomId;
    } catch (e) {
      throw toMaterixError(e, "join");
    }
  }

  async acceptInvite(roomId: string): Promise<void> {
    try {
      await this.client.joinRoom(roomId);
    } catch (e) {
      throw toMaterixError(e, "join");
    }
  }

  async rejectInvite(roomId: string): Promise<void> {
    try {
      await this.client.leave(roomId);
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  async setRoomTag(roomId: string, tag: "m.favourite" | "m.lowpriority", enabled: boolean): Promise<void> {
    if (enabled) await this.client.setRoomTag(roomId, tag, { order: 0.5 });
    else await this.client.deleteRoomTag(roomId, tag);
  }

  /**
   * Browse a server's public room directory. `server` defaults to the user's
   * own homeserver; pass another domain to explore it (federation permitting).
   */
  async publicRooms(opts: { query?: string; server?: string; since?: string }): Promise<PublicRoomsPage> {
    try {
      const res = await this.client.publicRooms({
        server: opts.server?.trim() || undefined,
        limit: 30,
        since: opts.since,
        ...(opts.query?.trim()
          ? { filter: { generic_search_term: opts.query.trim() } }
          : {}),
      });
      const rooms: PublicRoomResult[] = res.chunk.map((r) => ({
        roomId: r.room_id,
        name: r.name || r.canonical_alias || r.room_id,
        topic: r.topic,
        alias: r.canonical_alias,
        avatarMxc: r.avatar_url,
        memberCount: r.num_joined_members ?? 0,
        worldReadable: !!r.world_readable,
        joinedAlready: this.client.getRoom(r.room_id)?.getMyMembership() === "join",
      }));
      return { rooms, nextBatch: res.next_batch, totalEstimate: res.total_room_count_estimate };
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  async searchUsers(query: string): Promise<UserSearchResult[]> {
    try {
      const res = await this.client.searchUserDirectory({ term: query, limit: 10 });
      const results = res.results.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
      }));
      // Exact user IDs are always offerable even when not in the directory.
      if (/^@[^:]+:.+/.test(query.trim()) && !results.some((r) => r.userId === query.trim())) {
        results.unshift({ userId: query.trim(), displayName: undefined, avatarUrl: undefined });
      }
      return results;
    } catch {
      return /^@[^:]+:.+/.test(query.trim()) ? [{ userId: query.trim() }] : [];
    }
  }

  async setProfile(p: { displayName?: string; avatarFile?: File }): Promise<void> {
    try {
      if (p.displayName !== undefined) await this.client.setDisplayName(p.displayName);
      if (p.avatarFile) {
        const upload = await this.client.uploadContent(p.avatarFile, { type: p.avatarFile.type });
        await this.client.setAvatarUrl(upload.content_uri);
      }
      this.events.emit("self");
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  async stop(): Promise<void> {
    this.client?.stopClient();
  }

  /** Sign out server-side (best effort) and destroy every local store. */
  async destroy(): Promise<void> {
    try {
      await this.client.logout(true);
    } catch {
      this.client.stopClient();
    }
    try {
      await this.client.store.deleteAllData();
    } catch {
      // stores may already be gone
    }
    try {
      await this.client.clearStores();
    } catch {
      // best effort
    }
    indexedDB.deleteDatabase(`materix-crypto-${this.key}::matrix-sdk-crypto`);
  }
}
