// Settings: appearance, accounts (profile, sign out), security per account
// (verification, devices, key backup).

import { useEffect, useState } from "react";
import { accountManager } from "../../core/manager";
import type { MatrixAccount } from "../../core/account";
import type { DeviceSummary, KeyBackupStatus, SasFlow } from "../../core/types";
import { Modal } from "../components/Modal";
import { Avatar } from "../components/Avatar";
import { IconKey, IconLogout, IconMonitor, IconMoon, IconShieldCheck, IconSun } from "../components/Icons";
import { useAccounts } from "../hooks";
import { useToast } from "../components/Toast";
import { getThemePref, setThemePref, type ThemePref } from "../theme";

export function SettingsDialog({
  onClose,
  onAddAccount,
  onStartVerification,
}: {
  onClose: () => void;
  onAddAccount: () => void;
  onStartVerification: (flow: SasFlow) => void;
}) {
  useAccounts();
  const accounts = accountManager.list();
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const { show, showError } = useToast();

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-grid">
        <div className="settings-section">
          <h3>Appearance</h3>
          <div className="theme-picker" role="radiogroup" aria-label="Theme">
            {(
              [
                ["system", "System", <IconMonitor key="i" size={15} />],
                ["light", "Light", <IconSun key="i" size={15} />],
                ["dark", "Dark", <IconMoon key="i" size={15} />],
              ] as [ThemePref, string, React.ReactNode][]
            ).map(([value, label, icon]) => (
              <button
                key={value}
                role="radio"
                aria-checked={theme === value}
                className={`chip${theme === value ? " selected" : ""}`}
                onClick={() => {
                  setTheme(value);
                  setThemePref(value);
                }}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h3>Accounts</h3>
          {accounts.map((a) => (
            <AccountSettings
              key={a.key}
              account={accountManager.account(a.key)}
              onStartVerification={onStartVerification}
              onSignOut={async () => {
                if (!confirm(`Sign out ${a.userId}? Encrypted history on this device will be removed.`)) return;
                try {
                  await accountManager.logout(a.key);
                  show("Signed out.");
                } catch (e) {
                  showError(e);
                }
              }}
            />
          ))}
          <button className="btn secondary" onClick={onAddAccount}>
            Add another account
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AccountSettings({
  account,
  onSignOut,
  onStartVerification,
}: {
  account: MatrixAccount;
  onSignOut: () => void;
  onStartVerification: (flow: SasFlow) => void;
}) {
  const info = account.info();
  const [expanded, setExpanded] = useState(false);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [backup, setBackup] = useState<KeyBackupStatus | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [crossSigningReady, setCrossSigningReady] = useState(false);
  const [displayName, setDisplayName] = useState(info.displayName);
  const [busy, setBusy] = useState(false);
  const [securityFlow, setSecurityFlow] = useState<"none" | "setup-password" | "show-key" | "restore">("none");
  const [setupPassword, setSetupPassword] = useState("");
  const [recoveryKeyOut, setRecoveryKeyOut] = useState("");
  const [recoveryKeyIn, setRecoveryKeyIn] = useState("");
  const { show, showError } = useToast();

  const refresh = () => {
    account.crypto.ownDevices().then(setDevices).catch(() => undefined);
    account.crypto.backupStatus().then(setBackup).catch(() => undefined);
    account.crypto.isThisDeviceVerified().then(setVerified).catch(() => undefined);
    account.crypto.crossSigningReady().then(setCrossSigningReady).catch(() => undefined);
  };

  useEffect(() => {
    if (!expanded) return;
    refresh();
    return account.crypto.events.on("status", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <div className="account-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--sp-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0 }}>
        <Avatar account={account} mxc={info.avatarUrl} name={info.displayName} id={info.userId} size={40} />
        <div className="account-row-info">
          <div className="name">{info.displayName}</div>
          <div className="sub">{info.userId}</div>
        </div>
        <button className="btn secondary small" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Hide" : "Manage"}
        </button>
      </div>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <div className="field">
            <label>Display name</label>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <input
                style={{ flex: 1, minWidth: 0 }}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-label="Display name"
              />
              <button
                className="btn primary small"
                disabled={busy || displayName.trim() === info.displayName || !displayName.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await account.setProfile({ displayName: displayName.trim() });
                    show("Display name updated.");
                  } catch (e) {
                    showError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
          <div className="field">
            <label>Avatar</label>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  await account.setProfile({ avatarFile: file });
                  show("Avatar updated.");
                } catch (err) {
                  showError(err);
                }
                e.target.value = "";
              }}
            />
          </div>

          <div className="settings-section">
            <h3>Security</h3>
            <div className="switch-row">
              <div>
                <div className="switch-title" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <IconShieldCheck size={16} />
                  This session
                </div>
                <div className="switch-sub">
                  {verified === null ? "Checking…" : verified ? "Verified" : "Not verified"}
                </div>
              </div>
              {verified === false && crossSigningReady && (
                <button
                  className="btn primary small"
                  onClick={async () => {
                    try {
                      onStartVerification(await account.crypto.startOwnVerification());
                    } catch (e) {
                      showError(e);
                    }
                  }}
                >
                  Verify with another device
                </button>
              )}
            </div>

            <div className="switch-row">
              <div>
                <div className="switch-title" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <IconKey size={16} />
                  Key backup
                </div>
                <div className="switch-sub">
                  {backup === null
                    ? "Checking…"
                    : backup.enabled
                      ? backup.trusted
                        ? `Active (version ${backup.version})`
                        : "Exists — enter your recovery key to connect"
                      : "Not set up"}
                </div>
              </div>
              {backup && !backup.enabled && (
                <button className="btn primary small" onClick={() => setSecurityFlow("setup-password")}>
                  Set up
                </button>
              )}
              {backup?.enabled && !backup.trusted && (
                <button className="btn primary small" onClick={() => setSecurityFlow("restore")}>
                  Restore
                </button>
              )}
            </div>

            {securityFlow === "setup-password" && (
              <div className="field">
                <label>Account password (needed to publish signing keys)</label>
                <input
                  type="password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                  <button className="btn secondary small" onClick={() => setSecurityFlow("none")}>
                    Cancel
                  </button>
                  <button
                    className="btn primary small"
                    disabled={busy || !setupPassword}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const key = await account.crypto.setupSecurity(setupPassword);
                        setRecoveryKeyOut(key);
                        setSecurityFlow("show-key");
                        setSetupPassword("");
                        refresh();
                      } catch (e) {
                        showError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? <span className="spinner" /> : "Continue"}
                  </button>
                </div>
              </div>
            )}

            {securityFlow === "show-key" && (
              <div className="field">
                <label>Your recovery key — store it somewhere safe. It is shown only once.</label>
                <div className="recovery-key-box">{recoveryKeyOut}</div>
                <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                  <button
                    className="btn secondary small"
                    onClick={() => navigator.clipboard.writeText(recoveryKeyOut).then(() => show("Copied."))}
                  >
                    Copy
                  </button>
                  <button
                    className="btn primary small"
                    onClick={() => {
                      setRecoveryKeyOut("");
                      setSecurityFlow("none");
                    }}
                  >
                    I saved it
                  </button>
                </div>
              </div>
            )}

            {securityFlow === "restore" && (
              <div className="field">
                <label>Recovery key</label>
                <input
                  value={recoveryKeyIn}
                  onChange={(e) => setRecoveryKeyIn(e.target.value)}
                  placeholder="EsT… (from when you set up backup)"
                  spellCheck={false}
                />
                <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                  <button className="btn secondary small" onClick={() => setSecurityFlow("none")}>
                    Cancel
                  </button>
                  <button
                    className="btn primary small"
                    disabled={busy || !recoveryKeyIn.trim()}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const { imported } = await account.crypto.restoreWithRecoveryKey(recoveryKeyIn);
                        show(`Restored ${imported} message keys.`);
                        setRecoveryKeyIn("");
                        setSecurityFlow("none");
                        refresh();
                      } catch (e) {
                        showError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? <span className="spinner" /> : "Restore"}
                  </button>
                </div>
              </div>
            )}

            <div>
              <h3 style={{ margin: "var(--sp-2) 0" }}>Sessions</h3>
              {devices.map((d) => (
                <div key={d.deviceId} className="device-row">
                  <div className="device-name">
                    <div>
                      {d.displayName ?? d.deviceId}
                      {d.isCurrent ? " (this session)" : ""}
                    </div>
                    <div className="sub">{d.deviceId}</div>
                  </div>
                  {d.verified ? (
                    <span className="tag ok">Verified</span>
                  ) : (
                    <span className="tag warn">Unverified</span>
                  )}
                  {!d.isCurrent && !d.verified && crossSigningReady && (
                    <button
                      className="btn secondary small"
                      onClick={async () => {
                        try {
                          onStartVerification(
                            await account.crypto.startDeviceVerification(info.userId, d.deviceId),
                          );
                        } catch (e) {
                          showError(e);
                        }
                      }}
                    >
                      Verify
                    </button>
                  )}
                </div>
              ))}
              {devices.length === 0 && <div className="field-hint">No session list available.</div>}
            </div>
          </div>

          <button className="btn danger-ghost" onClick={onSignOut}>
            <IconLogout size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
