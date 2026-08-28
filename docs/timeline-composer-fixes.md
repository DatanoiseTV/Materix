# Timeline & composer fixes (mobile polish round)

Five fixes shipped together on `feat/nav-mode-parity`, verified with
`tsc --noEmit`, `vite build`, and live headless-browser runs against a local
Synapse fixture (see `.agents/nav-parity/verify-fixes.mjs`).

## 1. Action bar opens on long-press, not on scroll taps

The message action bar (quick reactions, reply, edit, …) used to toggle on any
touch *click* landing on a bubble — a scroll or swipe that ended near a bubble
fired that click, so the bar popped up while scrolling.

`src/ui/Timeline.tsx` now runs a pointer-based long-press detector on each
message row: `pointerdown` (non-mouse, on the bubble, not on a link) starts a
470 ms timer, cancelled by movement past a 9 px slop (a scroll) or an early
`pointerup`/`pointercancel` (a tap). Only a completed hold toggles the bar.
The synthetic click that follows a long-press is swallowed so it doesn't
immediately toggle the bar back off, and the `contextmenu` event Android
synthesizes from a long-press is suppressed for touch pointers (touch uses the
action bar; real right-clicks still open the desktop context menu). A plain
tap never opens the bar but does dismiss an open one. Desktop
hover-to-reveal and right-click behavior are unchanged.

## 2. Logout in the header avatar menu

The avatar dropdown (Manage account / Add account / Show-Hide accounts bar /
Settings) gained a final, red **Logout** item that signs out the *active*
account via the same `accountManager.logout` path as Settings → Accounts →
Sign out (confirmation included). The Settings → Accounts sign-out button was
deliberately kept: it is the canonical per-account management surface and the
only way to sign out a *non-active* account in multi-account setups.

## 3. Composer bottom margin on first keyboard open (Android)

On Android the keyboard inset reached the page (via the MainActivity
IME-inset listener, see `.github/workflows/android.yml`), but the composer's
bottom offset was only correct after some later reflow (e.g. the textarea
auto-growing) — the initial keyboard-open read of the viewport metrics could
be stale, because the WebView updates `window.innerHeight` and
`visualViewport.height` at slightly different moments than it dispatches the
resize events.

`src/ui/viewport.ts` now:

- sizes `--app-h` from the *smallest credible* height
  (`min(visualViewport.height, innerHeight)`) so whichever metric updated
  first wins during a keyboard open;
- re-applies the measurement on a settle schedule (rAF + 100/250/500/1000 ms)
  after every resize/orientation/`focusin`/`focusout` trigger, so late metric
  updates (including the keyboard-close direction, where the stale value is
  the *small* one) converge without needing a reflow;
- re-scrolls the focused field whenever the usable height actually changes
  (previously only on raw resize events).

Verified on desktop-shaped viewports that `--app-h` still tracks the
viewport; **the actual first-open IME margin needs on-device confirmation**
(no emulator available in this environment — the reasoning is from the inset
pipeline above).

## 4. Copy actions work in the Android WebView

`navigator.clipboard` is undefined/blocked in the Android WebView, so "Copy
text" (and every other copy action) silently did nothing. New shared helper
`src/ui/clipboard.ts` `copyText()` tries, in order:

1. the Tauri `clipboard-manager` plugin — now wired: Cargo dependency +
   `tauri_plugin_clipboard_manager::init()` in `src-tauri/src/lib.rs`,
   `clipboard-manager:allow-write-text` in `src-tauri/capabilities/default.json`,
   and the `@tauri-apps/plugin-clipboard-manager` guest package;
2. `navigator.clipboard.writeText`;
3. a hidden `<textarea>` + `document.execCommand("copy")`.

It rejects only if all three fail, so success/error toasts are truthful.
Routed through it: message "Copy text" (`Timeline.tsx`), "Copy user ID"
(`userMenu.ts`), "Copy room address" (`RoomList.tsx`), and the recovery-key
Copy button (`SecurityDialog.tsx`).

## 5. Editing a message no longer errors (and a failed edit stays an edit)

Two stacked bugs:

- **Root cause of the error**: an edit target captured from the timeline can
  be a still-sending local echo whose id is `~<roomId>:<txnId>`. Sending an
  `m.replace` relation to a `~` id makes matrix-js-sdk call
  `Room.getPendingEvents()`, which **throws** under the default
  `pendingEventOrdering: chronological` ("Cannot call getPendingEvents…").
  Encrypted rooms keep the pending window long enough to hit this routinely.
  `RoomHandle.edit()` now resolves the target first (`resolveEventId`):
  a stale `~` id is re-resolved via the transaction id embedded in it (the id
  is swapped in place once the remote echo arrives), polling up to 10 s for
  the echo; a clear, retriable `MaterixError` is raised if the original never
  finishes sending. Send errors are wrapped with `toMaterixError` like every
  other send path (previously the raw error surfaced as "Something went
  wrong.").
- **Root cause of the duplicate**: `Composer.send()` cleared the edit/reply
  mode *before* awaiting the send, so after a failure the restored text was
  re-sent through the plain-send path as a brand-new message. The mode is now
  cleared only after the send succeeds; a failure keeps the edit target and
  the corrected text so Send retries the *edit*. The edit branch also no
  longer falls through to a plain send when the event id is missing.

Verified live: a fast edit of a just-sent message in an encrypted room lands
as an edit; with the `/send/` endpoint failure-injected, the edit errors,
stays in edit mode with the corrected text, and the retry (after unblocking)
replaces the original message — rendered "(edited)", no duplicate.
