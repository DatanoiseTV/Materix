# Changelog

All notable changes to Materix are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-09-02

### Added

- Android support: a mobile-first layout, touch gestures, IME/keyboard handling
  that keeps the composer above the on-screen keyboard, an old-WebView "compat"
  build, and background notifications on de-Googled devices over UnifiedPush + ntfy.
- A self-hosted F-Droid repository (published to GitHub Pages) so Android users
  can install and auto-update without the Play Store.
- A Content-Security-Policy on both the desktop webview and the web build.
- Keyboard accessibility across the timeline: focusable message rows and action
  menus, image thumbnails as buttons, a focus-trapped image lightbox, a
  keyboard-seekable audio player, and a focus-trapped emoji picker.
- Tests for the HTML sanitizer, link-safety heuristics, and the passcode key wrap.

### Fixed

- Media that fails to load now shows a retry affordance instead of an endless spinner.
- Phishing check no longer treats every `*.co.uk`-style site as one domain.
- Push-notification titles from the gateway payload are sanitized and length-clamped.
- Correctness: the unread divider surviving read receipts, a voice-recorder
  AudioContext leak, the encryption-warning gate missing late-added accounts, a
  second account's incoming call staying hidden, a room-list crash on malformed
  local storage, and unbounded auto-fill back-pagination.
- The media object-URL cache is now a bounded LRU that revokes evicted URLs.
- Mobile: inputs no longer trigger WebView auto-zoom; Enter inserts a newline on
  touch keyboards; the composer no longer grows behind the keyboard.

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
- Location: send current location (rendered as an embedded map), and share
  live location (MSC3672 beacons) for a chosen duration with a "Stop sharing"
  control. Others' live beacons render in a panel with a map that recenters as
  they move.
- Media gallery per room (Info → Media): grid of photos/videos from history
  with a lightbox and pagination, plus a Files list.
- Synthesized notification sounds (twelve presets), customizable with preview.
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
