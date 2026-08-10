// Right column: room info, members, room actions.

import { useEffect, useState } from "react";
import { accountManager } from "../core/manager";
import { useRoomVersion, useRoomsVersion } from "./hooks";
import type { Selection } from "./RoomList";
import { getPrefs, roomSoundKey, setRoomSound } from "./prefs";
import type { SoundId } from "./sounds";
import { SoundPicker } from "./components/SoundPicker";
import { ensureRoomChannel, isAndroid, removeRoomChannel } from "./notifyChannels";
import { Avatar } from "./components/Avatar";
import { ContextMenu, type MenuState } from "./components/ContextMenu";
import { buildUserMenu, powerLevelMessage } from "./userMenu";
import { MediaGallery } from "./MediaGallery";
import { RoomSettingsDialog } from "./dialogs/RoomSettingsDialog";
import { IconLock, IconLogout, IconSettings, IconStar, IconX } from "./components/Icons";
import { useToast } from "./components/Toast";

export function DetailsPane({
  selection,
  onClose,
  onLeft,
}: {
  selection: Selection;
  onClose: () => void;
  onLeft: () => void;
}) {
  useRoomsVersion();
  const account = accountManager.tryAccount(selection.accountKey);
  useRoomVersion(account, selection.roomId);
  const [inviteInput, setInviteInput] = useState("");
  const [inviting, setInviting] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [tab, setTab] = useState<"info" | "media">("info");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { show, showError } = useToast();
  const [roomSound, setRoomSoundState] = useState<SoundId | undefined>(
    () => getPrefs().roomSounds[roomSoundKey(selection.accountKey, selection.roomId)],
  );
  useEffect(() => {
    setRoomSoundState(getPrefs().roomSounds[roomSoundKey(selection.accountKey, selection.roomId)]);
  }, [selection.accountKey, selection.roomId]);

  if (!account) return null;
  let handle;
  try {
    handle = account.room(selection.roomId);
  } catch {
    return null;
  }
  const details = handle.details();
  const members = handle.members();
  const summary = account.rooms().find((r) => r.roomId === selection.roomId);

  async function doInvite() {
    const target = inviteInput.trim();
    if (!/^@[^:]+:.+/.test(target)) {
      show("Enter a full user ID like @alice:matrix.org", "error");
      return;
    }
    setInviting(true);
    try {
      await handle!.invite(target);
      show(`Invited ${target}.`);
      setInviteInput("");
    } catch (e) {
      showError(e);
    } finally {
      setInviting(false);
    }
  }

  return (
    <aside className="details-pane" aria-label="Room details">
      <div className="details-header">
        <span>Room info</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close room info">
          <IconX size={18} />
        </button>
      </div>
      <div className="details-body">
        <div className="details-identity">
          <Avatar account={account} mxc={summary?.avatarUrl} name={details.name} id={details.roomId} size={72} />
          <h2>{details.name}</h2>
          {details.topic && <div className="details-topic">{details.topic}</div>}
          <div className="details-kv">
            {details.isEncrypted && (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center" }}>
                <IconLock size={13} /> End-to-end encrypted
              </span>
            )}
            <code>{details.canonicalAlias ?? details.roomId}</code>
          </div>
        </div>

        <div className="server-suggestions" role="tablist" aria-label="Details view">
          <button role="tab" aria-selected={tab === "info"} className={`chip${tab === "info" ? " selected" : ""}`} onClick={() => setTab("info")}>
            Info
          </button>
          <button role="tab" aria-selected={tab === "media"} className={`chip${tab === "media" ? " selected" : ""}`} onClick={() => setTab("media")}>
            Media
          </button>
        </div>

        {tab === "media" ? (
          <MediaGallery account={account} roomId={selection.roomId} />
        ) : (
          <>
        <div className="settings-section">
          <h3>Actions</h3>
          <button
            className="btn secondary"
            onClick={() =>
              account
                .setRoomTag(selection.roomId, "m.favourite", !summary?.isFavorite)
                .catch(showError)
            }
          >
            <IconStar size={16} />
            {summary?.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </button>
          <button
            className="btn secondary"
            onClick={() =>
              account
                .setRoomTag(selection.roomId, "m.lowpriority", !summary?.isLowPriority)
                .catch(showError)
            }
          >
            {summary?.isLowPriority ? "Restore priority" : "Mark low priority"}
          </button>
          {details.canEditRoom && (
            <button className="btn secondary" onClick={() => setSettingsOpen(true)}>
              <IconSettings size={16} /> Room settings
            </button>
          )}
          <button
            className="btn danger-ghost"
            onClick={async () => {
              if (!confirm(`Leave "${details.name}"?`)) return;
              try {
                await handle!.leave();
                onLeft();
              } catch (e) {
                showError(e);
              }
            }}
          >
            <IconLogout size={16} /> Leave room
          </button>
        </div>

        <div className="settings-section">
          <h3>Notifications</h3>
          <div className="switch-title" style={{ marginBottom: "var(--sp-1)" }}>
            Sound for this room
          </div>
          <SoundPicker
            label={`Notification sound for ${details.name}`}
            inheritLabel="Account default"
            value={roomSound}
            onChange={(id) => {
              setRoomSoundState(id);
              setRoomSound(selection.accountKey, selection.roomId, id);
              // Android: a room-specific sound means a dedicated notification
              // channel; drop it again when the override is cleared.
              if (id === undefined) void removeRoomChannel(selection.accountKey, selection.roomId);
              else void ensureRoomChannel(selection.accountKey, selection.roomId, details.name);
            }}
          />
          {isAndroid && (
            <div className="field-hint">
              Setting a sound gives this room its own Android notification channel ("Room ·{" "}
              {details.name}") — assign it any system tone under Android Settings → Apps → Materix →
              Notifications.
            </div>
          )}
        </div>

        {details.canInvite && (
          <div className="settings-section">
            <h3>Invite</h3>
            <div className="field" style={{ flexDirection: "row", gap: "var(--sp-2)" }}>
              <input
                style={{ flex: 1, minWidth: 0 }}
                placeholder="@user:server.org"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doInvite()}
                aria-label="User ID to invite"
              />
              <button className="btn primary small" disabled={inviting || !inviteInput.trim()} onClick={doInvite}>
                Invite
              </button>
            </div>
          </div>
        )}

        <div className="settings-section">
          <h3>{members.length} members</h3>
          <div>
            {members.slice(0, 100).map((m) => (
              <button
                key={m.userId}
                className="member-row"
                title={m.userId}
                aria-haspopup="menu"
                onClick={(e) => {
                  e.preventDefault();
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: buildUserMenu(account, m.userId, {
                      show,
                      showError,
                      roomId: selection.roomId,
                      canKick: details.canKick,
                      onKick: () => {
                        if (confirm(`Remove ${m.name} from the room?`)) handle!.kick(m.userId).catch(showError);
                      },
                      canBan: handle?.canBan() ?? false,
                      onBan: () => {
                        const reason = prompt(`Ban ${m.name} from this room? Optionally add a reason:`);
                        if (reason === null) return;
                        handle!
                          .ban(m.userId, reason || undefined)
                          .then(() => show("User banned."))
                          .catch(showError);
                      },
                      canChangePower: handle?.canChangePower() ?? false,
                      myLevel: details.myPowerLevel,
                      targetLevel: m.powerLevel,
                      defaultLevel: handle?.defaultPowerLevel() ?? 0,
                      onSetPower: (level) => {
                        handle!
                          .setPowerLevel(m.userId, level)
                          .then(() => show(powerLevelMessage(m.name, level, handle!.defaultPowerLevel())))
                          .catch(showError);
                      },
                    }),
                  });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.currentTarget.click();
                }}
              >
                <Avatar account={account} mxc={m.avatarUrl} name={m.name} id={m.userId} size={32} />
                <span className="member-name">{m.name}</span>
                {m.powerLevel >= 100 ? (
                  <span className="member-pl">Admin</span>
                ) : m.powerLevel >= 50 ? (
                  <span className="member-pl">Mod</span>
                ) : null}
              </button>
            ))}
            {members.length > 100 && <div className="field-hint">Showing first 100 members.</div>}
          </div>
        </div>
          </>
        )}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {settingsOpen && <RoomSettingsDialog account={account} handle={handle} onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
