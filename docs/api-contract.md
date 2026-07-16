# Materix — API contract
_Authoritative. Keep in lockstep with implementation._

Materix is a Matrix client. There is no Materix-owned server: the network
boundary is the **Matrix Client-Server API**, an external spec we consume
through `matrix-js-sdk`. This contract therefore pins three surfaces:

1. **Matrix CS API subset** — which spec endpoints/features Materix relies on.
2. **Core boundary** — the `AccountManager` / `MatrixAccount` TypeScript
   surface the UI codes against. UI code never imports `matrix-js-sdk`
   directly outside `src/core/`.
3. **Tauri IPC surface** — commands the desktop shell exposes to the webview.

## Versioning

- Matrix spec: Client-Server API **v1.11** semantics (as implemented by
  `matrix-js-sdk` v34+). Server support discovered via `/_matrix/client/versions`.
- `matrix-js-sdk` and `@matrix-org/matrix-sdk-crypto-wasm` versions are pinned
  in `package.json`; upgrades are deliberate commits, never drive-by.
- Internal surfaces below follow semver with the app version.

## Auth

Per-account **access token + device ID**, obtained via `m.login.password` or
`m.login.sso` (fallback: whatever flows `/login` advertises; unsupported flows
are surfaced, not hidden). Tokens are persisted per account:

- **Web**: `localStorage` key `materix.account.<accountKey>` (JSON `SessionData`).
- **Desktop (Tauri)**: OS keychain via IPC command `secret_set`/`secret_get`
  (Stronghold/keychain plugin); `localStorage` is NOT used for tokens on desktop.

`accountKey` = `sha256(userId + "|" + deviceId).slice(0,16)`. Logout calls
`/logout` best-effort, then always destroys local session + crypto stores.

## Matrix CS API subset (consumed via matrix-js-sdk)

Materix requires these server capabilities; features degrade gracefully
(hidden UI) when a server lacks an optional one.

| Area | Spec surface | Required |
|------|-------------|----------|
| Discovery | `/.well-known/matrix/client`, `/versions` | yes |
| Auth | `/login` (password, SSO redirect), `/logout`, `/refresh` | yes |
| Sync | `/sync` (long-poll via SDK) | yes |
| Rooms | create/join/leave/invite/kick, aliases, `/publicRooms` | yes |
| Timeline | send/receive `m.room.message`, edits (`m.replace`), replies (`m.in_reply_to`), reactions (`m.annotation`), redactions, threads read-only | yes |
| Media | authenticated media download (v1.11), upload, thumbnails | yes |
| E2EE | Olm/Megolm via rust-crypto, `/keys/*`, to-device, SAS verification (emoji), key backup (`m.megolm_backup.v1.curve25519-aes-sha2`), cross-signing, secret storage | yes |
| Receipts/typing | `m.read`, `m.read.private`, typing | yes |
| Presence | `/presence` | optional |
| Profiles | displayname/avatar get+set | yes |
| Account data | `m.direct`, tags, `io.materix.settings` (archive/mute sync) | yes |
| Directory | `/publicRooms` (any server), `/user_directory/search` | yes |
| Extensible events | polls (MSC3381), voice messages (MSC3245), location (`m.location`) | yes |
| Notifications | push rules evaluated client-side (SDK), no push gateway in v0 | yes |
| Search | client-side room/member filter; server `/search` later | v0: no |
| VoIP | none in v0 | no |

## Types

Shared domain types live in `src/core/types.ts`; the UI imports from there only.

```ts
/** Stable local identifier for a logged-in account (see Auth). */
type AccountKey = string;

/** Persisted session; the only shape ever written to storage/keychain. */
interface SessionData {
  userId: string;          // @user:server.tld
  deviceId: string;
  accessToken: string;
  refreshToken?: string;   // present when server uses refresh tokens
  homeserverUrl: string;   // resolved base URL after .well-known discovery
  identityServerUrl?: string;
}

/** UI-facing account snapshot. */
interface AccountInfo {
  key: AccountKey;
  userId: string;
  displayName: string;
  avatarUrl?: string;      // already resolved to an http(s) URL
  homeserverName: string;  // server_name for display, e.g. "matrix.org"
  color: string;           // deterministic per-account accent (hsl string)
  syncState: 'initial' | 'syncing' | 'ready' | 'error' | 'stopped';
}

/** Room list entry, denormalized for rendering without SDK access. */
interface RoomSummary {
  accountKey: AccountKey;
  roomId: string;
  name: string;
  avatarUrl?: string;
  isDirect: boolean;
  isEncrypted: boolean;
  isFavorite: boolean;
  isLowPriority: boolean;
  isInvite: boolean;
  unreadCount: number;         // notification count from server
  highlightCount: number;      // mentions
  lastEvent?: { ts: number; senderName: string; preview: string };
  typing: string[];            // display names currently typing
}

/** Timeline item; `kind` discriminates rendering. */
interface TimelineItem {
  id: string;                  // event ID or local echo txn ID
  kind: 'message' | 'member' | 'state' | 'encrypted-pending' | 'redacted' | 'day-divider' | 'read-marker';
  sender: { userId: string; name: string; avatarUrl?: string };
  ts: number;
  sendState?: 'sending' | 'sent' | 'failed';   // local echoes only
  body?: MessageBody;
  reactions?: Record<string, { count: number; mine: boolean }>;
  replyTo?: { sender: string; preview: string; eventId: string };
  edited?: boolean;
}

type MessageBody =
  | { msgtype: 'm.text' | 'm.notice' | 'm.emote'; text: string; html?: string }
  | { msgtype: 'm.image' | 'm.video'; text: string; src: string; thumb?: string; w?: number; h?: number; mime: string; size: number }
  | { msgtype: 'm.file' | 'm.audio'; text: string; src: string; mime: string; size: number };

/** Device verification (SAS) session state machine, UI-facing. */
interface SasFlow {
  flowId: string;
  peer: { userId: string; deviceId: string };
  phase: 'requested' | 'ready' | 'emojis' | 'confirmed' | 'done' | 'cancelled';
  emojis?: { symbol: string; name: string }[];  // 7 entries in 'emojis' phase
  accept(): Promise<void>; confirmMatch(): Promise<void>; cancel(): Promise<void>;
}
```

## Core boundary (src/core)

```ts
interface AccountManager {
  /** Restore all persisted sessions, start clients. Resolves when stores are open (not synced). */
  init(): Promise<void>;
  /** Password/SSO login against a homeserver (does .well-known discovery). */
  login(server: string, opts: { user: string; password: string } | { ssoToken: string }): Promise<AccountKey>;
  logout(key: AccountKey): Promise<void>;
  list(): AccountInfo[];
  /** The active account for compose/actions; room list shows all accounts. */
  active: AccountKey | null;
  account(key: AccountKey): MatrixAccount;    // throws on unknown key
  on(event: 'accounts' | 'rooms' | 'sync', cb: () => void): () => void;
}

interface MatrixAccount {
  info(): AccountInfo;
  rooms(): RoomSummary[];
  room(roomId: string): RoomHandle;           // timeline, send, receipts, membership
  createRoom(opts: { name?: string; invite?: string[]; direct?: boolean; encrypted?: boolean; public?: boolean; topic?: string }): Promise<string>;
  joinRoom(idOrAlias: string): Promise<string>;
  startDm(userId: string): Promise<string>;   // reuses existing m.direct room
  searchUsers(query: string): Promise<{ userId: string; displayName?: string; avatarUrl?: string }[]>;
  setProfile(p: { displayName?: string; avatarFile?: File }): Promise<void>;
  crypto: CryptoFacade;                        // verification, backup, device list
}
```

`RoomHandle` and `CryptoFacade` are defined alongside these in
`src/core/types.ts`; same rules apply (UI consumes, core implements).

## Tauri IPC surface

Desktop-only; the web build feature-detects `window.__TAURI__` and falls back.

### invoke("secret_set", { key: string, value: string }) → void
**Purpose.** Store a `SessionData` JSON blob in the OS keychain.
**Idempotency.** Safe to retry (overwrite).
**Errors.** `KEYCHAIN_UNAVAILABLE` → caller falls back to localStorage with a user-visible warning.

### invoke("secret_get", { key: string }) → string | null
### invoke("secret_delete", { key: string }) → void
Same error model. `secret_list_keys() → string[]` enumerates `materix.*` entries for session restore.

Window controls, notifications, badge count, and autostart use official Tauri
plugins (`window`, `notification`), not custom commands.

## Errors

Matrix `errcode`s are mapped once, in `src/core/errors.ts`, to typed
`MaterixError { code, userMessage, retriable }`. UI never string-matches SDK errors.

| code | from | meaning / UX |
|------|------|--------------|
| BAD_CREDENTIALS | M_FORBIDDEN on /login | wrong user/password |
| RATE_LIMITED | M_LIMIT_EXCEEDED | auto-retry after `retry_after_ms`, then surface |
| SERVER_UNREACHABLE | network / .well-known failure | "Can't reach <server>" + retry |
| SESSION_EXPIRED | M_UNKNOWN_TOKEN | account marked signed-out, re-auth prompt; local data kept unless user removes account |
| NO_PERMISSION | M_FORBIDDEN elsewhere | action-specific message |
| UNSUPPORTED_SERVER | missing required spec version | shown at login |
| DECRYPTION_FAILURE | UTD event | timeline placeholder + key re-request |

## Rate limits / quotas

Client honors `M_LIMIT_EXCEEDED.retry_after_ms` everywhere (SDK default plus
one retry layer in core for sends). Media uploads capped at the size from
`/_matrix/client/v1/media/config`; checked before upload starts.
