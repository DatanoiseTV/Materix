# E2E: keyboard-overlap audit

`keyboard-audit.mjs` guards against the "input hidden behind the soft keyboard"
class of bug (see the `fix/android-composer-and-verification` MainActivity IME-inset
patch). For every app view with a text input it focuses the input on a running
Android emulator and asserts **both**:

1. the soft keyboard actually appears (`dumpsys input_method` → `mInputShown=true`), and
2. the input stays visible above it — the **visual viewport shrinks** when the
   keyboard shows *and* the input's rect fits inside the shrunk viewport.

Why (2) is the right signal: in the broken (edge-to-edge, no inset) state the
keyboard appears but the WebView keeps full height — the visual viewport does
**not** shrink — so a bottom-anchored input sits behind the keyboard. The harness
reports that as `FAIL_NO_RESIZE`; a resized-but-still-clipped input is `FAIL_HIDDEN`.

## Run

```bash
# emulator running + debug APK installed & logged in (see the android-emulator-debug skill)
ANDROID_SERIAL=emulator-5554 pnpm test:e2e:keyboard
# debug per-view navigation: KBAUDIT_DEBUG=1 node e2e/keyboard-audit.mjs
```

Dep-free: uses `adb` + Node's built-in `WebSocket` (Node ≥ 22) over the debug
build's Chrome DevTools socket (selected by the app PID). Exits non-zero if any
input is hidden.

## Keyboard = real-user experience

A real phone has no hardware keyboard, so the harness forces the on-screen
keyboard on (`settings put secure show_ime_with_hard_keyboard 1`) — the AVD
forwards the host hardware keyboard, which would otherwise suppress the soft
keyboard. Run the emulator with **≥ 6 GB RAM** (`hw.ramSize`), otherwise Android's
low-memory killer reaps the app / WebView renderer mid-run.

## Status

All 12 covered views PASS (viewport 915→578, input within it): chat-list search;
new-chat DM / group-name / group-invite / join-by-address / explore; room
composer; in-room search; emoji search; room-info invite; room-settings name +
topic.

The room-info invite field was originally flagged `FAIL_HIDDEN` (bottom ~14px
behind the keyboard) — a real bug this audit caught: the focus scroll-into-view
runs against the taller pre-keyboard viewport and nothing re-scrolls after the
keyboard shrinks it. Fixed in `src/ui/viewport.ts` (re-scroll the focused field
on visual-viewport resize).

## Notes / extending

- Nav is in-app only (CDP `element.click()` / `history.back()`), never adb BACK —
  that backgrounds the app and Android's LMK reaps it. Reset via `ensureList`
  closes overlays FIRST (checkVisibility() reports covered controls as visible).
- Selectors go by `aria-label` (e.g. "New chat", "Back to chat list", "Search
  messages", "Room info", "Insert emoji"). Add more surfaces (thread reply, poll,
  forward, image caption, passcode, settings→Manage) as `VIEWS` entries — those
  need multi-step flows to reach.
- Not wired into `ci.yml` (that runner has no emulator). Run locally, or add an
  emulator CI job (e.g. `reactivecircus/android-emulator-runner`) that installs the
  APK and runs this.
