# Changelog

All notable changes to Materix are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-07-16

Initial release.

### Added

- Multi-account, multi-homeserver login with `.well-known` discovery, password
  and SSO flows; sessions persisted to `localStorage` (web) or the OS keychain
  (desktop).
- Unified room list across all accounts: invites, favorites, DMs, rooms,
  low-priority, and a collapsible archive section; unread/highlight badges,
  typing previews, per-account accent colors, search filter, context menus.
- Timeline with day dividers, grouped messages, replies, edits, redactions,
  reactions (+ emoji picker), read receipts, typing indicators, and
  scroll-to-first-unread on open.
- Message types: `m.text` (Markdown → sanitized HTML), `m.notice`, `m.emote`,
  `m.image`/`m.video`/`m.audio` with thumbnails, `m.file`, and `m.location`.
- Voice messages (MSC3245) with recorded waveform + a seekable audio player.
- Polls (MSC3381): create, vote, live results, end.
- End-to-end encryption via Rust crypto, on by default for DMs and private
  rooms; per-account crypto stores.
- SAS emoji verification for own sessions and contacts (in-room); cross-signing
  bootstrap, secret storage, and server-side key backup with recovery-key
  setup/restore; first-run security banner.
- Explore public room directories on any server; user directory search.
- Room management: create DM/group/room, join by alias, invite, kick, room
  info, leave; own profile (display name + avatar) editing.
- Archive/restore and mute (presets or indefinite); muted rooms skip
  notifications.
- Web/desktop notifications honoring push rules, with privacy modes
  (preview / name only / off).
- Light/dark/system themes; responsive layout with a native-feeling mobile view
  and safe-area handling.
- Tauri 2 desktop shell with keychain-backed session storage and native
  notifications.

[0.1.0]: https://example.com/materix/releases/tag/v0.1.0
