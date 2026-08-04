# Materix

A multi-account [Matrix](https://matrix.org) client for web and desktop, built
to feel like a mainstream messenger (Signal / Telegram / WhatsApp) while
staying a full Matrix client for power users. End-to-end encryption is on by
default for direct messages and new private rooms.

Materix has no backend of its own: it talks directly to Matrix homeservers over
the [Client-Server API](https://spec.matrix.org/v1.11/client-server-api/) via
`matrix-js-sdk`, with encryption handled by the Rust `matrix-sdk-crypto` WASM
module. The desktop build is a thin [Tauri 2](https://tauri.app) shell that
stores access tokens in the OS keychain.

> Status: pre-1.0 (`0.y.z`). The feature set below works and is verified, but
> the public surface is not yet frozen and breaking changes can land between
> minor versions.

## Features

### Accounts and encryption
- **Multi-account, multi-homeserver.** Log into several accounts at once; one
  unified chat list across all of them, each with its own accent color.
- **Sign up or sign in.** Register a new account on a homeserver (password +
  dummy-stage UIA; servers requiring captcha/email/token registration are
  detected and pointed to their web sign-up), plus password and SSO sign-in.
- **End-to-end encryption.** Rust crypto, on by default for DMs and private
  rooms, per-account crypto stores.
- **Device & user verification.** Interactive SAS (emoji) verification for your
  own sessions and for contacts (in-room, the standard Matrix flow). Contact
  verification reuses the room you started it from instead of opening a new DM.
- **Secure key backup.** First-run prompt to set up cross-signing + secret
  storage + server-side key backup; restore encrypted history on a new device
  with your recovery key.

### Messaging
- **Rich messages.** `m.text` with Markdown → sanitized HTML, `m.notice`,
  `m.emote`, images/video/audio with thumbnails, arbitrary files, and
  `m.location` rendered as an embedded map. Replies, edits, redactions,
  reactions (with an emoji picker), read receipts, typing indicators.
- **Clickable links with phishing protection.** URLs are auto-linked; a link
  that looks deceptive (shortener, raw IP, punycode look-alike, embedded
  credentials, or anchor text naming a different site than the destination)
  prompts a warning that lists the reasons, with a per-domain "don't ask again"
  trust list.
- **Threads.** A dedicated thread panel with an "N replies" affordance on
  thread roots, reply-in-thread, and an inline thread composer.
- **Forwarding.** Forward any message to another room/chat via a searchable
  picker across all your accounts.
- **Voice messages** (MSC3245) with a live-recorded waveform, and a seekable
  audio player that keeps playing when you switch chats, with a persistent
  now-playing bar.
- **Polls** (MSC3381): create, single- or multi-select vote, live results, end.
- **Location** sharing: current location, or live location (MSC3672 beacons)
  for a chosen duration with a Stop-sharing control; others' live beacons
  render on a map that recenters as they move.

### Sending images (privacy tools)
- **Edit before sending.** Attaching, pasting, or dropping an image opens an
  editor with crop, rotate, freehand **pen** annotations, and a secure
  **censor** (black-out or pixelate) whose regions are baked destructively into
  the exported pixels.
- **Metadata stripping.** EXIF/GPS and other metadata are removed by default via
  a canvas re-encode; if a photo carries GPS, the editor says so explicitly.
- **Drag-and-drop.** Drop files anywhere on a chat; a full-area overlay confirms
  the drop, and images route through the editor.

### Organizing and browsing
- **Spaces.** Filter the unified room list by Matrix Space (with a Home view for
  rooms in no space), resolving nested space hierarchies.
- **Explore.** Browse any server's public room directory and search the user
  directory (where the server supports it).
- **Media gallery.** Per-room grid of photos/videos and a files list, loaded
  lazily as you scroll back through history.
- **Organize.** Favorites, low-priority, archive (collapsible section), and mute
  with presets or "until I turn it back on". Muted rooms stay quiet.
- **Notifications** honoring server push rules, with privacy modes (name +
  message preview, name only, or off) and twelve synthesized notification
  sounds (no audio assets shipped).

### Look and feel
- **Light / dark / system themes** with a neutral-slate palette, keyboard
  navigation, and a responsive layout down to phone widths with safe-area
  handling and a native-feeling mobile view.

## Stack

| Layer | Choice |
|-------|--------|
| UI | React 19 + hand-written CSS (no component framework) |
| Matrix | `matrix-js-sdk` 41.9.0 (pinned), `@matrix-org/matrix-sdk-crypto-wasm` |
| Build | Vite 6, TypeScript strict |
| Desktop | Tauri 2 (Rust), `keyring` for the OS keychain |

The UI never imports `matrix-js-sdk` directly — everything goes through the
core layer in `src/core/` (`AccountManager` → `MatrixAccount` → `RoomHandle`,
plus `CryptoFacade`). The boundary is documented in
[`docs/api-contract.md`](docs/api-contract.md).

## Getting started

```bash
pnpm install
pnpm dev          # web app at http://localhost:1420
```

Desktop:

```bash
pnpm tauri dev    # runs the Tauri shell
pnpm tauri build  # produces a native bundle
```

On first run, pick a homeserver (defaults to matrix.org), sign in, and — for
encrypted chats — accept the "Set up secure backup" prompt so your history
survives across devices.

## Project layout

```
src/core/     Matrix boundary: accounts, rooms, timeline, crypto, media
src/ui/       React UI: room list, timeline, composer, dialogs, components
src-tauri/    Tauri 2 desktop shell (keychain IPC, notifications)
docs/         API contract (authoritative for the Matrix + IPC boundary)
```

## Verification

Beyond `tsc`/build, features are checked against reality rather than assumed:

- **Live homeserver** (headless-Chrome CDP driving the real webview + a Node
  peer running matrix-js-sdk): login, sync, unified room list, send/receive in
  an encrypted DM, and SAS emoji verification reaching the verified state on
  both sides.
- **Image privacy pipeline** (headless): a crafted GPS-tagged JPEG is detected,
  confirmed stripped after re-encode, and censored regions verified to contain
  only black pixels.
- **Link-safety heuristics** across representative benign and phishing URLs.
- **Theme and layout** via rendered screenshots in light and dark.
- **Notification sounds** rendered offline to confirm each is distinct and
  non-silent.

## Not yet implemented / known limitations

- **VoIP / calls** are not implemented.
- **Server-side message search** is not wired up (local, loaded-history only).
- **Notifications are client-side only** (no push gateway), so they require the
  app to be open.
- **Local data at rest**: the sync store (room metadata, and any
  unencrypted-room content) is not encrypted at rest by the app; E2EE room
  content is stored as ciphertext. An app-managed at-rest encryption layer was
  prototyped and rolled back for being unsafe to migrate onto existing crypto
  stores; a non-destructive version is on the roadmap.

## Roadmap

Rough order, subject to change:

1. **Native right-click menus everywhere** — consistent custom context menus so
   the app never falls back to the browser menu.
2. **Mobile pass** — audit and tighten every screen for touch and small
   viewports.
3. **At-rest encryption, done safely** — encrypt local stores with an
   OS-keychain-backed key (desktop) and an optional passcode, without
   invalidating existing crypto stores.
4. **Background notifications** — a push path that works when the app is closed.
5. **Calls** — 1:1 and group VoIP.

## Contributing

Issues and PRs are welcome. Keep the `src/core` / `src/ui` boundary intact (the
UI must not import `matrix-js-sdk` directly), update `docs/api-contract.md`
before changing the Matrix/IPC surface, and run `pnpm build` (which type-checks)
before opening a PR.

## License

Not yet chosen — until a license is added, the default "all rights reserved"
applies. A permissive license is intended before 1.0.
