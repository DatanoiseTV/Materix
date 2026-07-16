// Settings: appearance, accounts (profile, sign out), security per account
// (verification, devices, key backup).

import { useEffect, useState } from "react";
import { accountManager } from "../../core/manager";
import type { MatrixAccount } from "../../core/account";
import type { DeviceSummary, SasFlow } from "../../core/types";
import { Modal } from "../components/Modal";
import { Avatar } from "../components/Avatar";
import { IconLogout, IconMonitor, IconMoon, IconShield, IconSun } from "../components/Icons";
import { useAccounts } from "../hooks";
import { useToast } from "../components/Toast";
import { getThemePref, setThemePref, type ThemePref } from "../theme";
import { getPrefs, setPref, type NotificationMode } from "../prefs";
import { SecurityDialog } from "./SecurityDialog";

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
  const [notifMode, setNotifMode] = useState<NotificationMode>(getPrefs().notifications);
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
          <h3>Notifications</h3>
          <div className="theme-picker" role="radiogroup" aria-label="Notification privacy">
            {(
              [
                ["preview", "Name and message"],
                ["name", "Name only"],
                ["off", "Off"],
              ] as [NotificationMode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                role="radio"
                aria-checked={notifMode === value}
                className={`chip${notifMode === value ? " selected" : ""}`}
                onClick={() => {
                  setNotifMode(value);
                  setPref("notifications", value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="field-hint">
            "Name only" shows who wrote without any message content — useful on shared screens.
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
  const [securityState, setSecurityState] = useState<string>("loading");
  const [displayName, setDisplayName] = useState(info.displayName);
  const [busy, setBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const { show, showError } = useToast();

  const refresh = () => {
    account.crypto.ownDevices().then(setDevices).catch(() => undefined);
    account.crypto.securityState().then(setSecurityState).catch(() => undefined);
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
                  <IconShield size={16} />
                  Encryption
                </div>
                <div className="switch-sub">
                  {securityState === "loading"
                    ? "Checking…"
                    : securityState === "ok"
                      ? "Session verified, backup connected"
                      : securityState === "needs-setup"
                        ? "Secure backup not set up"
                        : securityState === "needs-verify"
                          ? "This session is not verified"
                          : "Unavailable"}
                </div>
              </div>
              {(securityState === "needs-setup" || securityState === "needs-verify" || securityState === "ok") && (
                <button className="btn primary small" onClick={() => setSecurityOpen(true)}>
                  Manage
                </button>
              )}
            </div>

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
                  {!d.isCurrent && !d.verified && securityState === "ok" && (
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

          {securityOpen && (
            <SecurityDialog
              account={account}
              onClose={() => {
                setSecurityOpen(false);
                refresh();
              }}
            />
          )}

          <button className="btn danger-ghost" onClick={onSignOut}>
            <IconLogout size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
