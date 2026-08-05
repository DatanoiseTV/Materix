// Shared domain types. Authoritative shapes: docs/api-contract.md.
// UI code imports from here and never from matrix-js-sdk directly.

export type AccountKey = string;

/** Persisted session; the only shape ever written to storage/keychain. */
export interface SessionData {
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken?: string;
  homeserverUrl: string;
  identityServerUrl?: string;
}

export type SyncStateName = "initial" | "syncing" | "ready" | "error" | "stopped";

/** UI-facing account snapshot. */
export interface AccountInfo {
  key: AccountKey;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  homeserverName: string;
  color: string;
  syncState: SyncStateName;
}

/** Room list entry, denormalized for rendering without SDK access. */
export interface RoomSummary {
  accountKey: AccountKey;
  roomId: string;
  name: string;
  avatarUrl?: string;
  isDirect: boolean;
  isEncrypted: boolean;
  isFavorite: boolean;
  isLowPriority: boolean;
  isArchived: boolean;
  /** Epoch ms until which the room is muted; 0 = not muted, Infinity = forever. */
  mutedUntil: number;
  isInvite: boolean;
  inviterName?: string;
  isSpace: boolean;
  unreadCount: number;
  /** Explicit MSC2867 marked-unread flag; shows the room as unread even at zero count. */
  markedUnread: boolean;
  highlightCount: number;
  lastActivityTs: number;
  lastEvent?: { ts: number; senderName: string; preview: string };
  typing: string[];
}

/** A joined space (room where isSpaceRoom() is true), for the space selector. */
export interface SpaceSummary {
  accountKey: AccountKey;
  roomId: string;
  name: string;
  avatarUrl?: string;
}

export type MessageBody =
  | { msgtype: "m.text" | "m.notice" | "m.emote"; text: string; html?: string }
  | {
      msgtype: "m.image" | "m.video";
      text: string;
      mxc: string;
      file?: EncryptedFileInfo;
      thumbMxc?: string;
      thumbFile?: EncryptedFileInfo;
      w?: number;
      h?: number;
      mime?: string;
      size?: number;
      /** Video duration in ms (m.video only), when the sender supplied it. */
      durationMs?: number;
    }
  | {
      msgtype: "m.file";
      text: string;
      mxc: string;
      file?: EncryptedFileInfo;
      mime?: string;
      size?: number;
    }
  | {
      msgtype: "m.audio";
      text: string;
      mxc: string;
      file?: EncryptedFileInfo;
      mime?: string;
      size?: number;
      /** Voice message (MSC3245): duration in ms and optional waveform. */
      voice?: boolean;
      durationMs?: number;
      waveform?: number[];
    }
  | {
      msgtype: "m.location";
      text: string;
      /** geo: URI, e.g. "geo:52.52,13.40;u=15". */
      geoUri: string;
      lat?: number;
      lon?: number;
    };

/** m.room.encrypted file payload (EncryptedFile in the spec). */
export interface EncryptedFileInfo {
  url: string;
  key: { k: string; alg: string; ext: boolean; kty: string; key_ops: string[] };
  iv: string;
  hashes: Record<string, string>;
  v: string;
}

export type TimelineItemKind =
  | "message"
  | "poll"
  | "member"
  | "state"
  | "encrypted-pending"
  | "redacted"
  | "ignored"
  | "day-divider"
  | "read-marker";

export interface TimelineItem {
  id: string;
  eventId?: string;
  kind: TimelineItemKind;
  sender: { userId: string; name: string; avatarUrl?: string };
  ts: number;
  /** Local echoes only. */
  sendState?: "sending" | "sent" | "failed";
  body?: MessageBody;
  /** For member/state items: pre-rendered one-line summary. */
  stateText?: string;
  reactions?: { key: string; count: number; mine: boolean }[];
  poll?: PollData;
  replyTo?: { sender: string; preview: string; eventId: string };
  edited?: boolean;
  isMine?: boolean;
  /** Rendering hint: first message of a same-sender group. */
  groupStart?: boolean;
  /** Read receipts to show under this event (other users). */
  receipts?: { userId: string; name: string; avatarUrl?: string }[];
  /** Set on a thread root message: number of replies in its thread. */
  threadReplyCount?: number;
}

/** One thread in a room, summarized for a thread list / affordance. */
export interface ThreadSummary {
  rootEventId: string;
  rootSenderName: string;
  rootPreview: string;
  replyCount: number;
  latestTs: number;
  latestPreview: string;
}

export interface PollData {
  eventId: string;
  question: string;
  kind: "disclosed" | "undisclosed";
  maxSelections: number;
  ended: boolean;
  answers: {
    id: string;
    text: string;
    votes: number;
    chosenByMe: boolean;
  }[];
  totalVotes: number;
}

export interface SasEmoji {
  symbol: string;
  name: string;
}

export type SasPhase = "requested" | "ready" | "emojis" | "confirmed" | "done" | "cancelled";

/** Device verification (SAS) session, UI-facing state machine. */
export interface SasFlow {
  flowId: string;
  accountKey: AccountKey;
  peer: { userId: string; deviceId?: string };
  /** True when we initiated the request. */
  initiatedByMe: boolean;
  phase: SasPhase;
  emojis?: SasEmoji[];
  cancelReason?: string;
  accept(): Promise<void>;
  confirmMatch(): Promise<void>;
  cancel(): Promise<void>;
}

export interface DeviceSummary {
  deviceId: string;
  displayName?: string;
  verified: boolean;
  isCurrent: boolean;
}

export interface KeyBackupStatus {
  enabled: boolean;
  version?: string;
  trusted: boolean;
}

export interface UserSearchResult {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface MediaItem {
  eventId: string;
  kind: "image" | "video" | "file";
  ts: number;
  senderName: string;
  /** Filename / caption. */
  text: string;
  mxc: string;
  file?: EncryptedFileInfo;
  thumbMxc?: string;
  thumbFile?: EncryptedFileInfo;
  mime?: string;
  size?: number;
  w?: number;
  h?: number;
}

/** A message pinned in the room (m.room.pinned_events), resolved for display. */
export interface PinnedMessage {
  eventId: string;
  /** Sender display name, or "" when the pinned event is not loaded. */
  senderName: string;
  /** One-line preview, or a placeholder when the event is not loaded. */
  preview: string;
  /** Origin timestamp, or 0 when the pinned event is not loaded. */
  ts: number;
  /** False when the pinned event id is not present in loaded history. */
  loaded: boolean;
}

/** One in-room search hit over loaded history. */
export interface SearchHit {
  eventId: string;
  senderName: string;
  ts: number;
  /** Plain-text excerpt around the first match; UI emphasizes the term. */
  snippet: string;
}

export interface MemberSummary {
  userId: string;
  name: string;
  avatarUrl?: string;
  powerLevel: number;
  membership: string;
}

export interface CreateRoomOpts {
  name?: string;
  topic?: string;
  invite?: string[];
  direct?: boolean;
  encrypted?: boolean;
  public?: boolean;
}

/** Whether new members can read history before they joined. */
export type HistoryVisibilityValue = "invited" | "joined" | "shared" | "world_readable";
/** How the room may be joined. Materix only offers the two common values. */
export type JoinRuleValue = "public" | "invite" | "knock" | "restricted";

export interface RoomDetails {
  roomId: string;
  name: string;
  topic?: string;
  avatarUrl?: string;
  canonicalAlias?: string;
  isEncrypted: boolean;
  isDirect: boolean;
  memberCount: number;
  myPowerLevel: number;
  canInvite: boolean;
  canKick: boolean;
  canRedactOthers: boolean;
  /** Current room join rule (defaults to "invite" when unset). */
  joinRule: JoinRuleValue;
  /** Current history visibility (defaults to "shared" when unset). */
  historyVisibility: HistoryVisibilityValue;
  /** Whether guests may join (m.room.guest_access). */
  guestAccess: "can_join" | "forbidden";
  /** Per-field edit permission, derived from the room power levels. */
  canEditName: boolean;
  canEditTopic: boolean;
  canEditAvatar: boolean;
  canEditJoinRule: boolean;
  canEditHistoryVisibility: boolean;
  canEditGuestAccess: boolean;
  /** True when the user may edit at least one room-settings field. */
  canEditRoom: boolean;
}

export interface SendFileProgress {
  loaded: number;
  total: number;
}

/** An active live-location share, from you or another member. */
export interface LiveBeacon {
  id: string;
  owner: { userId: string; name: string; avatarUrl?: string };
  mine: boolean;
  description?: string;
  /** Latest reported position, if any location has arrived yet. */
  lat?: number;
  lon?: number;
  accuracy?: number;
  /** Epoch ms of the latest location update. */
  updatedTs?: number;
  /** Epoch ms when the share expires. */
  expiresTs: number;
}

export interface PublicRoomResult {
  roomId: string;
  name: string;
  topic?: string;
  alias?: string;
  avatarMxc?: string;
  memberCount: number;
  worldReadable: boolean;
  joinedAlready: boolean;
}

export interface PublicRoomsPage {
  rooms: PublicRoomResult[];
  nextBatch?: string;
  totalEstimate?: number;
}
