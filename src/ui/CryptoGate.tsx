// Loud, blocking warning shown when the E2EE crypto engine failed to start
// (almost always: the device's System WebView is too old to run the crypto
// WASM, which needs WebAssembly reference-types / Chromium 96+). Secure
// messaging and verification are impossible in this state, so we refuse to
// proceed until the user explicitly acknowledges the risk once per session.
import { useEffect, useState } from "react";
import { accountManager } from "../core/manager";

export function CryptoGate() {
  // Acknowledge per broken user-id, not once for the whole session: an account
  // added later whose crypto fails is a NEWLY-broken id, so it must re-raise the
  // warning even after an earlier ack.
  const [acked, setAcked] = useState<string[]>([]);
  const [broken, setBroken] = useState<string[]>([]);

  const accountKeys = accountManager
    .list()
    .map((a) => a.key)
    .join(",");
  useEffect(() => {
    const check = () => {
      setBroken(
        accountManager
          .list()
          .map((a) => accountManager.account(a.key))
          .filter((acc) => acc.cryptoAvailable === false)
          .map((acc) => acc.session.userId),
      );
    };
    check();
    const unsubs = accountManager.list().map((a) => accountManager.account(a.key).events.on("self", check));
    // Crypto init runs during account start; re-check shortly after mount.
    const t = setTimeout(check, 3000);
    return () => {
      unsubs.forEach((u) => u());
      clearTimeout(t);
    };
    // Re-subscribe when the account set changes so a late account is covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKeys]);

  const unacked = broken.filter((id) => !acked.includes(id));
  if (unacked.length === 0) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Encryption unavailable"
      style={{
        position: "fixed",
        // NB: explicit sides, not `inset:0` — the `inset` shorthand is Chromium
        // 87+ and this gate must render on old WebViews (Chromium ~83).
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100000,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: "100%",
          background: "#16181e",
          border: "1px solid #3a2020",
          borderRadius: 14,
          padding: "24px",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontSize: 44, lineHeight: 1 }} aria-hidden="true">
          ⚠️
        </div>
        <h2 style={{ margin: "12px 0 6px", color: "#ff6b6b" }}>Encryption unavailable</h2>
        <p style={{ color: "var(--text-1, #e6e8ec)", fontSize: 15, lineHeight: 1.5 }}>
          Materix couldn't start its end-to-end encryption engine on this device. This almost always
          means your <strong>Android System WebView is too old</strong> — secure messaging needs
          Chromium&nbsp;96 or newer.
        </p>
        <p style={{ color: "var(--text-2, #aab0bb)", fontSize: 14, lineHeight: 1.5 }}>
          Until it's updated, this session <strong>cannot encrypt or decrypt secure messages and
          cannot verify devices</strong>. Messages in encrypted rooms will fail to send or stay
          unreadable.
        </p>
        <p style={{ color: "var(--text-2, #aab0bb)", fontSize: 13, lineHeight: 1.5 }}>
          Fix: update <strong>Android System WebView</strong> (or install an updated WebView such as
          Mulch/Bromite and pick it in Developer options → "WebView implementation"), then reopen
          Materix.
        </p>
        <button
          onClick={() => setAcked((prev) => Array.from(new Set([...prev, ...broken])))}
          style={{
            marginTop: 14,
            padding: "11px 18px",
            width: "100%",
            border: "1px solid #7a2b2b",
            borderRadius: 10,
            background: "#3a1b1b",
            color: "#ffd9d9",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          I understand — continue without encryption
        </button>
      </div>
    </div>
  );
}
