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

## Features

- **Multi-account, multi-homeserver.** Log into several accounts at once; one
  unified chat list across all of them, each with its own accent color.
- **End-to-end encryption.** Rust crypto, encryption on by default for DMs and
  private rooms, per-account crypto stores.
- **Device & user verification.** Interactive SAS (emoji) verification for your
  own sessions and for contacts (in-room verification, the standard Matrix
  flow). Verified live against a real homeserver.
- **Secure key backup.** First-run prompt to set up cross-signing + secret
  storage + server-side key backup; restore encrypted history on a new device
  with your recovery key.
- **Rich messages.** `m.text` with Markdown → sanitized HTML, `m.notice`,
  `m.emote`, images/video/audio with thumbnails, arbitrary files, and
  `m.location`. Replies, edits, redactions, reactions (with an emoji picker),
  read receipts, typing indicators.
- **Voice messages** (MSC3245) with a live-recorded waveform, and a seekable
  audio player widget with download.
- **Polls** (MSC3381): create, vote, live results, end.
- **Explore.** Browse any server's public room directory and search the user
  directory (where the server supports it).
- **Organize.** Favorites, low-priority, archive (collapsible section), and
  mute with presets or "until I turn it back on". Muted rooms stay quiet.
- **Notifications** honoring server push rules, with privacy modes: name +
  message preview, name only, or off.
- **Light / dark / system themes**, keyboard-navigable, responsive down to
  phone widths with safe-area handling and a native-feeling mobile layout.

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

## Verification status

Exercised end-to-end against a live homeserver (headless-Chrome CDP driving the
real webview + a Node peer running matrix-js-sdk):

- Login, sync, unified room list, open room.
- Send/receive in an **encrypted** DM (message encrypted, delivered, decrypted).
- **SAS emoji verification** between two sessions — both show identical emojis
  and reach the verified state.
- Session restore across reloads; light/dark themes; mobile viewport layout.

What is **not** implemented in v0.1.0: VoIP/calls, server-side message search,
spaces navigation (spaces are hidden from the list), threads (thread replies
render inline, no thread view), and a push gateway (notifications are
client-side only, so they require the app to be open).

## License

TBD.
