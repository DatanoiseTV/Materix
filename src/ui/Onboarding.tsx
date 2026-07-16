// Welcome + login. Two steps: pick a server, then credentials.
// Also used as "add account" from inside the app (embedded=true renders
// the same card in a modal-like context).

import { useEffect, useState, type FormEvent } from "react";
import { accountManager } from "../core/manager";
import { MaterixError } from "../core/errors";
import { useToast } from "./components/Toast";

const SUGGESTED_SERVERS = ["matrix.org", "mozilla.org", "fedora.im"];

export function Onboarding({
  onDone,
  onCancel,
  embedded,
}: {
  onDone: () => void;
  onCancel?: () => void;
  /** Render just the card (for the add-account modal) instead of the full page. */
  embedded?: boolean;
}) {
  const [step, setStep] = useState<"server" | "credentials">("server");
  const [server, setServer] = useState("matrix.org");
  const [flows, setFlows] = useState<{ password: boolean; sso: boolean } | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();

  // Complete an SSO redirect if we returned with a loginToken.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("loginToken");
    const ssoServer = sessionStorage.getItem("materix.ssoServer");
    if (!token || !ssoServer) return;
    window.history.replaceState(null, "", window.location.pathname);
    sessionStorage.removeItem("materix.ssoServer");
    setBusy(true);
    accountManager
      .login(ssoServer, { ssoToken: token })
      .then(() => {
        show("Signed in.");
        onDone();
      })
      .catch((e) => setError(e instanceof MaterixError ? e.userMessage : "Sign-in failed."))
      .finally(() => setBusy(false));
  }, [onDone, show]);

  async function checkServer(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const f = await accountManager.loginFlows(server);
      setFlows(f);
      setStep("credentials");
    } catch (err) {
      setError(err instanceof MaterixError ? err.userMessage : "Could not check that server.");
    } finally {
      setBusy(false);
    }
  }

  async function doLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountManager.login(server, { user: user.trim(), password });
      onDone();
    } catch (err) {
      setError(err instanceof MaterixError ? err.userMessage : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doSso() {
    setBusy(true);
    setError(null);
    try {
      window.location.href = await accountManager.ssoLoginUrl(server);
    } catch (err) {
      setError(err instanceof MaterixError ? err.userMessage : "Could not start single sign-on.");
      setBusy(false);
    }
  }

  const card = (
    <div className="onboarding-card">
        <div className="onboarding-logo">
          <div className="onboarding-logo-mark">M</div>
          <div>
            <h1>{embedded ? "Add account" : "Materix"}</h1>
            <p className="onboarding-sub">{embedded ? "Sign in to another Matrix account" : "Secure messaging on Matrix"}</p>
          </div>
        </div>

        {step === "server" && (
          <form onSubmit={checkServer} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <div className="field">
              <label htmlFor="server">Homeserver</label>
              <input
                id="server"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="matrix.org"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              <div className="field-hint">
                Your account lives on a homeserver. If you're unsure, keep matrix.org.
              </div>
            </div>
            <div className="server-suggestions" role="group" aria-label="Suggested servers">
              {SUGGESTED_SERVERS.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`chip${server === s ? " selected" : ""}`}
                  onClick={() => setServer(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            {error && <div className="form-error">{error}</div>}
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              {onCancel && (
                <button type="button" className="btn secondary" onClick={onCancel} style={{ flex: 1 }}>
                  Cancel
                </button>
              )}
              <button className="btn primary" disabled={busy || !server.trim()} style={{ flex: 2 }}>
                {busy ? <span className="spinner" /> : "Continue"}
              </button>
            </div>
          </form>
        )}

        {step === "credentials" && (
          <form onSubmit={doLogin} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <div className="field-hint">
              Signing in to <strong>{server}</strong>{" "}
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setStep("server");
                  setError(null);
                }}
              >
                change
              </button>
            </div>
            {flows?.password !== false && (
              <>
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="alice"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              {flows?.password !== false && (
                <button className="btn primary" disabled={busy || !user.trim() || !password}>
                  {busy ? <span className="spinner" /> : "Sign in"}
                </button>
              )}
              {flows?.sso && (
                <button type="button" className="btn ghost" disabled={busy} onClick={doSso}>
                  Continue with single sign-on
                </button>
              )}
              {!flows?.password && !flows?.sso && (
                <div className="form-error">This server offers no supported sign-in method.</div>
              )}
            </div>
          </form>
        )}
    </div>
  );

  if (embedded) return card;
  return <div className="onboarding">{card}</div>;
}
