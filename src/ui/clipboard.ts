// Clipboard writes that work on every platform we ship to.
//
// `navigator.clipboard` is unavailable or permission-blocked in the Android
// WebView (and any non-secure context), where its promise rejects and nothing
// is copied. Try, in order:
//   1. the Tauri clipboard-manager plugin (native, works in the WebView),
//   2. the async clipboard API,
//   3. a hidden textarea + document.execCommand("copy") (the WebView path).
// Resolves once one succeeds; rejects only if all fail, so callers can toast
// success/failure truthfully.

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function tauriWrite(text: string): Promise<void> {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(text);
}

function execCommandWrite(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  // Off-screen but focusable; readonly avoids popping the keyboard on mobile.
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    ta.remove();
    active?.focus?.();
  }
  if (!ok) throw new Error("execCommand copy failed");
}

// Remember the account a piece of text was last copied FROM inside the app, so
// the composer can warn before it's pasted into a different account (opt-in; see
// warnCrossAccountPaste). Only in-app copies are tracked — we can't see the
// source of text copied from other apps.
let lastInAppCopy: { accountKey: string; text: string } | null = null;

/** If `text` matches the last in-app copy and it came from a DIFFERENT account,
 *  return that source account key; otherwise null. */
export function crossAccountCopySource(text: string, currentAccountKey: string): string | null {
  if (!lastInAppCopy || lastInAppCopy.text !== text) return null;
  return lastInAppCopy.accountKey !== currentAccountKey ? lastInAppCopy.accountKey : null;
}

export async function copyText(text: string, sourceAccountKey?: string): Promise<void> {
  // Tag the source account for copies that carry room content (message text),
  // so a later cross-account paste can be flagged.
  if (sourceAccountKey) lastInAppCopy = { accountKey: sourceAccountKey, text };
  if (isTauri()) {
    try {
      await tauriWrite(text);
      return;
    } catch {
      // plugin not registered on this platform/build — fall through
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // undefined off secure contexts, or permission denied — fall through
  }
  execCommandWrite(text);
}
