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
import { SOUND_OPTIONS, playSound, type SoundId } from "../sounds";
import { hasPasscode, setPasscode, clearPasscode } from "../../core/cryptoStoreKey";
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
  const [sound, setSound] = useState<SoundId>(getPrefs().sound);
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

          <div style={{ marginTop: "var(--sp-2)" }}>
            <div className="switch-title" style={{ marginBottom: "var(--sp-1)" }}>Notification sound</div>
            <div className="theme-picker" role="radiogroup" aria-label="Notification sound" style={{ flexWrap: "wrap" }}>
              {SOUND_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  role="radio"
                  aria-checked={sound === opt.id}
                  className={`chip${sound === opt.id ? " selected" : ""}`}
                  onClick={() => {
                    setSound(opt.id);
                    setPref("sound", opt.id);
                    playSound(opt.id); // preview on pick
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="field-hint">Click a sound to preview it. Plays when a new message notifies.</div>
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

            <PasscodeSetting account={account} />

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

// Optional app passcode: wraps this account's crypto-store key with a
// passcode-derived key for strong at-rest protection (mainly meaningful on
// web, where there's no OS keychain). Enabling/disabling re-wraps the same key,
// so it never invalidates the crypto store or requires re-verification.
function PasscodeSetting({ account }: { account: MatrixAccount }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const { show, showError } = useToast();

  useEffect(() => {
    hasPasscode(account.key).then(setEnabled).catch(() => setEnabled(false));
  }, [account]);

  // The crypto store must be unlocked (key in memory) to (un)wrap it.
  const ready = !!account.storageKey;

  const enable = async () => {
    if (p1.length < 4) return show("Use at least 4 characters.", "error");
    if (p1 !== p2) return show("Passcodes don't match.", "error");
    setBusy(true);
    try {
      await setPasscode(account.key, account.storageKey!, p1);
      setEnabled(true);
      setEditing(false);
      setP1("");
      setP2("");
      show("App passcode enabled.");
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!confirm("Remove the app passcode? Local data keeps device-level protection only.")) return;
    setBusy(true);
    try {
      await clearPasscode(account.key, account.storageKey!);
      setEnabled(false);
      show("App passcode removed.");
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) return null;

  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      <div className="switch-row">
        <div>
          <div className="switch-title">App passcode</div>
          <div className="switch-sub">
            {!ready
              ? "Available once encryption is ready"
              : enabled
                ? "Required on launch to unlock local data"
                : "Add a passcode for stronger at-rest encryption"}
          </div>
        </div>
        {enabled ? (
          <button className="btn secondary small" disabled={busy || !ready} onClick={disable}>
            Remove
          </button>
        ) : (
          <button className="btn primary small" disabled={busy || !ready} onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Set passcode"}
          </button>
        )}
      </div>

      {editing && !enabled && (
        <form
          className="passcode-form"
          onSubmit={(e) => {
            e.preventDefault();
            enable();
          }}
        >
          <input
            type="password"
            autoFocus
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            placeholder="New passcode"
            aria-label="New passcode"
          />
          <input
            type="password"
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            placeholder="Confirm passcode"
            aria-label="Confirm passcode"
          />
          <button type="submit" className="btn primary small" disabled={busy || !p1 || !p2}>
            Enable passcode
          </button>
        </form>
      )}
    </div>
  );
}
