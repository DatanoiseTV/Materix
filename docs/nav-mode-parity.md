# Nav mode parity: Chats/Rooms toggles, unread badges, always-on rail

## Problem

The left-column navigation rendered a *different* control set depending on
orientation (`max-width: 760px`):

| Control | Landscape (wide) | Portrait (narrow) — before |
| --- | --- | --- |
| Account avatar / rail | visible | **hidden** with a single account (`.rail:not(.multi) { display: none }`) |
| Add account / Settings (rail) | visible | **hidden** with a single account |
| Chats/Rooms sections | **none** (plain `<h1>Chats</h1>`) | text tabs, mutually exclusive |
| Settings (list header) | **none** | visible |

So the avatar existed only in landscape (and clicking it was a no-op for the
active/only account), while the Chats/Rooms split existed only in portrait.
Rotating the device made buttons appear and disappear.

## Requirements

1. **Mode parity (critical).** Every nav button is present and functional in
   both portrait and landscape. A control's *presence* is never gated on
   orientation — only sizing/layout may adapt.
2. **Chats/Rooms as icon toggles.** Chats = talk bubble (`IconChat`), Rooms =
   hash glyph (`IconHash`, new). They are *independent* show/hide filters
   (`showChats` / `showRooms`, both default on), not mutually exclusive tabs.
   Classification is unchanged: Chats = `isDirect`, Rooms = everything else.
   Each toggle exposes `aria-pressed` plus a title/aria-label.
3. **Per-toggle unread badges.** The Chats icon shows the unread total of
   direct rooms, the Rooms icon of non-direct rooms — each computed like the
   rail badge (`unreadCount` + 1 per pending invite), clamped at "99+".
4. **Useful avatar.** The account avatar is visible in both modes; clicking
   the *active* (or only) account opens Settings instead of no-op
   re-activation. Clicking another account still switches to it.

## After

Both orientations render the same controls:

- **Account rail** — avatar(s) with total-unread badge, add-account "+",
  Settings gear. Vertical at the left in landscape; horizontal strip at the
  top in portrait (the `.rail:not(.multi)` hiding rule is gone). Active
  avatar click → Settings; other avatar click → switch account.
- **Room-list header** — Chats toggle (bubble icon + unread badge), Rooms
  toggle (hash icon + unread badge), explore globe, new-chat "+". The
  header's narrow-only Settings gear was removed (the rail now provides
  Settings everywhere), as was the wide-only `<h1>Chats</h1>` heading.

Toggle semantics: both on (default) shows everything; hiding one filters out
that half of the list; hiding both shows an "Everything is hidden" empty
state. Invitations remain visible regardless of filters (existing behavior),
and the invite/archived/low-priority grouping is unchanged.

## Implementation notes

- `src/ui/RoomList.tsx` — `section: "chats" | "rooms"` state replaced by
  `showChats`/`showRooms` booleans; header rendered unconditionally (no
  `narrow` media-query gating left in this component); per-section unread
  reducers mirror the rail's; empty-state branches keyed off the toggles.
- `src/ui/components/Icons.tsx` — added `IconHash`.
- `src/ui/app.css` — `.section-tab` restyled as an icon toggle with a
  `.section-badge` (mirrors `.rail-badge`); removed the portrait
  `.rail:not(.multi){display:none}` rule; portrait keeps its larger touch
  targets (40px) via the existing media query.

Verified with `tsc --noEmit`, `vite build`, and a live headless-browser run
against a local Synapse fixture (DM with 3 unread + group room with 5
unread): all controls present and working in both 412×915 and 915×412, badges
"3"/"5" on the toggles, independent filtering, avatar→Settings in both modes.
