// Keeps the app shell aligned with the *visual* viewport so the message
// composer is never hidden behind the Android/iOS soft keyboard.
//
// On Android the soft keyboard does not shrink the layout viewport by default
// (it only shrinks the visual viewport), so a `height: 100%` shell keeps its
// full height and its bottom-anchored composer ends up behind the keyboard.
// We track `window.visualViewport` and publish two CSS custom properties on
// <html> that the stylesheet consumes:
//
//   --app-h     usable height in px (the visual viewport height) — `.app` is
//               sized to this, so shrinking it lifts the composer into view.
//   --kb-inset  height currently covered by the keyboard at the bottom, in px
//               (0 when the keyboard is closed) — available for other bottom
//               anchored UI that wants to dodge the keyboard.
//
// Works whether or not the WebView is configured with `adjustResize` /
// `interactive-widget=resizes-content`, because the height is driven directly
// from the measured visual viewport rather than from any native resize.

export function installViewportTracking(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;

  const apply = () => {
    const h = vv ? vv.height : window.innerHeight;
    // Portion of the layout viewport hidden below the visual viewport — this
    // is the keyboard when it is open (accounts for any page pan via offsetTop).
    const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty("--app-h", `${Math.round(h)}px`);
    root.style.setProperty("--kb-inset", `${Math.round(covered)}px`);
  };

  apply();

  if (vv) {
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
  }
  // Fallbacks for environments without visualViewport and for rotation.
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
}
