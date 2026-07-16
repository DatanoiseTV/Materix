// Security setup / recovery for one account. Reached from the first-run
// banner and from Settings. Three situations:
//  - needs-setup:  bootstrap cross-signing + secret storage + key backup
//  - needs-verify: verify this session (another device or recovery key)
//  - ok:           show status
import { useEffect, useState } from "react";
import type { MatrixAccount } from "../../core/account";
import { Modal } from "../components/Modal";
import { IconKey, IconShieldCheck } from "../components/Icons";
import { useToast } from "../components/Toast";
import { uiBus } from "../bus";

export function SecurityDialog({ account, onClose }: { account: MatrixAccount; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "needs-setup" | "needs-verify" | "ok" | "unavailable">("loading");
  const [password, setPassword] = useState("");
  const [recoveryKeyOut, setRecoveryKeyOut] = useState("");
  const [recoveryKeyIn, setRecoveryKeyIn] = useState("");
  const [busy, setBusy] = useState(false);
  const { show, showError } = useToast();

  const refresh = () => {
    account.crypto.securityState().then(setState).catch(() => setState("unavailable"));
  };
  useEffect(() => {
    refresh();
    return account.crypto.events.on("status", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  return (
    <Modal title="Secure messaging" onClose={onClose}>
      {state === "loading" && (
        <div className="empty-state" style={{ padding: "var(--sp-4)" }}>
          <span className="spinner" />
        </div>
      )}

      {state === "unavailable" && <p>Encryption isn't available for this account right now.</p>}

      {state === "needs-setup" && !recoveryKeyOut && (
        <>
          <p>
            Set up <strong>secure backup</strong> so you can read encrypted messages on new devices and never lose
            them. You'll get a recovery key — keep it somewhere safe.
          </p>
          <div className="field">
            <label htmlFor="sec-pw">Account password</label>
            <input
              id="sec-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <div className="field-hint">Needed once to publish your signing keys.</div>
          </div>
          <button
            className="btn primary"
            disabled={busy || !password}
            onClick={async () => {
              setBusy(true);
              try {
                setRecoveryKeyOut(await account.crypto.setupSecurity(password));
                setPassword("");
              } catch (e) {
                showError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : "Set up secure backup"}
          </button>
        </>
      )}

      {recoveryKeyOut && (
        <>
          <p>
            <strong>Your recovery key.</strong> Save it in a password manager or write it down — it is shown only
            once and is the only way to restore your messages if you lose all devices.
          </p>
          <div className="recovery-key-box">{recoveryKeyOut}</div>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button
              className="btn secondary"
              onClick={() => navigator.clipboard.writeText(recoveryKeyOut).then(() => show("Copied."))}
            >
              Copy
            </button>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={() => {
                setRecoveryKeyOut("");
                refresh();
                show("Secure backup is ready.");
                onClose();
              }}
            >
              I saved my recovery key
            </button>
          </div>
        </>
      )}

      {state === "needs-verify" && !recoveryKeyOut && (
        <>
          <p>
            Verify this session to access your encrypted message history and let others trust this device.
          </p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              try {
                const flow = await account.crypto.startOwnVerification();
                uiBus.showFlow(flow);
                onClose();
              } catch (e) {
                showError(e);
              }
            }}
          >
            <IconShieldCheck size={16} /> Verify with another device
          </button>
          <div className="field">
            <label htmlFor="sec-rk">Or enter your recovery key</label>
            <input
              id="sec-rk"
              value={recoveryKeyIn}
              onChange={(e) => setRecoveryKeyIn(e.target.value)}
              placeholder="EsT2 ..."
              spellCheck={false}
            />
          </div>
          <button
            className="btn secondary"
            disabled={busy || !recoveryKeyIn.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const { imported } = await account.crypto.restoreWithRecoveryKey(recoveryKeyIn);
                show(`Session verified. Restored ${imported} message keys.`);
                setRecoveryKeyIn("");
                refresh();
                onClose();
              } catch (e) {
                showError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : <IconKey size={16} />} Restore with recovery key
          </button>
        </>
      )}

      {state === "ok" && (
        <>
          <p style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <IconShieldCheck size={18} /> This session is verified and key backup is connected.
          </p>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      )}
    </Modal>
  );
}
