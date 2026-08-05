// Room settings editor: name, topic, avatar, join rule, history visibility,
// and guest access. Each field is saved on its own and disabled when the user
// lacks the required power level. All room mutations go through RoomHandle.

import { useEffect, useState } from "react";
import type { MatrixAccount } from "../../core/account";
import type { RoomHandle } from "../../core/roomHandle";
import type { HistoryVisibilityValue } from "../../core/types";
import { Modal } from "../components/Modal";
import { Avatar } from "../components/Avatar";
import { useToast } from "../components/Toast";

const HISTORY_OPTIONS: { value: HistoryVisibilityValue; label: string }[] = [
  { value: "world_readable", label: "Anyone, even without joining" },
  { value: "shared", label: "Members, from the point they were invited" },
  { value: "invited", label: "Members, from when they were invited" },
  { value: "joined", label: "Members, from when they joined" },
];

export function RoomSettingsDialog({
  account,
  handle,
  onClose,
}: {
  account: MatrixAccount;
  handle: RoomHandle;
  onClose: () => void;
}) {
  const details = handle.details();
  const { show, showError } = useToast();

  const [name, setName] = useState(details.name);
  const [topic, setTopic] = useState(details.topic ?? "");
  const [joinRule, setJoinRule] = useState<"public" | "invite">(details.joinRule === "public" ? "public" : "invite");
  const [history, setHistory] = useState<HistoryVisibilityValue>(details.historyVisibility);
  const [guestAccess, setGuestAccess] = useState(details.guestAccess === "can_join");

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>();

  const [savingName, setSavingName] = useState(false);
  const [savingTopic, setSavingTopic] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingJoin, setSavingJoin] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [savingGuest, setSavingGuest] = useState(false);

  // Object URL preview for a freshly-picked avatar; revoke to avoid leaks.
  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  async function saveName() {
    setSavingName(true);
    try {
      await handle.setRoomName(name.trim());
      show("Room name updated.");
    } catch (e) {
      showError(e);
    } finally {
      setSavingName(false);
    }
  }

  async function saveTopic() {
    setSavingTopic(true);
    try {
      await handle.setTopic(topic);
      show("Topic updated.");
    } catch (e) {
      showError(e);
    } finally {
      setSavingTopic(false);
    }
  }

  async function saveAvatar() {
    if (!avatarFile) return;
    setSavingAvatar(true);
    try {
      await handle.setRoomAvatar(avatarFile);
      show("Room avatar updated.");
      setAvatarFile(null);
    } catch (e) {
      showError(e);
    } finally {
      setSavingAvatar(false);
    }
  }

  async function changeJoinRule(next: "public" | "invite") {
    const prev = joinRule;
    setJoinRule(next);
    setSavingJoin(true);
    try {
      await handle.setJoinRule(next);
      show(next === "public" ? "Anyone can now join." : "Room is now invite only.");
    } catch (e) {
      setJoinRule(prev);
      showError(e);
    } finally {
      setSavingJoin(false);
    }
  }

  async function changeHistory(next: HistoryVisibilityValue) {
    const prev = history;
    setHistory(next);
    setSavingHistory(true);
    try {
      await handle.setHistoryVisibility(next);
      show("History visibility updated.");
    } catch (e) {
      setHistory(prev);
      showError(e);
    } finally {
      setSavingHistory(false);
    }
  }

  async function changeGuestAccess(next: boolean) {
    const prev = guestAccess;
    setGuestAccess(next);
    setSavingGuest(true);
    try {
      await handle.setGuestAccess(next);
      show(next ? "Guests can now join." : "Guests can no longer join.");
    } catch (e) {
      setGuestAccess(prev);
      showError(e);
    } finally {
      setSavingGuest(false);
    }
  }

  return (
    <Modal title="Room settings" onClose={onClose}>
      <div className="field">
        <label htmlFor="rs-name">Name</label>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <input
            id="rs-name"
            style={{ flex: 1, minWidth: 0 }}
            value={name}
            disabled={!details.canEditName}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn primary small"
            disabled={!details.canEditName || savingName || !name.trim() || name.trim() === details.name}
            onClick={saveName}
          >
            {savingName ? <span className="spinner" /> : "Save"}
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rs-topic">Topic</label>
        <textarea
          id="rs-topic"
          rows={3}
          value={topic}
          disabled={!details.canEditTopic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What is this room about?"
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn primary small"
            disabled={!details.canEditTopic || savingTopic || topic === (details.topic ?? "")}
            onClick={saveTopic}
          >
            {savingTopic ? <span className="spinner" /> : "Save"}
          </button>
        </div>
      </div>

      <div className="field">
        <label>Avatar</label>
        <div className="room-settings-avatar">
          <Avatar
            account={account}
            mxc={avatarPreview ?? details.avatarUrl}
            name={details.name}
            id={details.roomId}
            size={64}
          />
          <div className="room-settings-avatar-controls">
            <input
              type="file"
              accept="image/*"
              disabled={!details.canEditAvatar}
              onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
            />
            {avatarFile && (
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button className="btn primary small" disabled={savingAvatar} onClick={saveAvatar}>
                  {savingAvatar ? <span className="spinner" /> : "Save avatar"}
                </button>
                <button className="btn secondary small" disabled={savingAvatar} onClick={() => setAvatarFile(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="field">
        <label>Who can join</label>
        <div className="room-settings-radios">
          <label className="room-settings-radio">
            <input
              type="radio"
              name="rs-join"
              checked={joinRule === "public"}
              disabled={!details.canEditJoinRule || savingJoin}
              onChange={() => changeJoinRule("public")}
            />
            <span>
              <span className="room-settings-radio-title">Public</span>
              <span className="field-hint">Anyone who knows the room can join.</span>
            </span>
          </label>
          <label className="room-settings-radio">
            <input
              type="radio"
              name="rs-join"
              checked={joinRule === "invite"}
              disabled={!details.canEditJoinRule || savingJoin}
              onChange={() => changeJoinRule("invite")}
            />
            <span>
              <span className="room-settings-radio-title">Invite only</span>
              <span className="field-hint">Only invited people can join.</span>
            </span>
          </label>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rs-history">History visibility</label>
        <select
          id="rs-history"
          className="room-settings-select"
          value={history}
          disabled={!details.canEditHistoryVisibility || savingHistory}
          onChange={(e) => changeHistory(e.target.value as HistoryVisibilityValue)}
        >
          {HISTORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="field-hint">Controls how much history new members can read.</div>
      </div>

      <div className="switch-row">
        <div>
          <div className="switch-title">Allow guests</div>
          <div className="switch-sub">Let guest accounts join without registering.</div>
        </div>
        <button
          className="switch"
          role="switch"
          aria-checked={guestAccess}
          aria-label="Allow guests"
          disabled={!details.canEditGuestAccess || savingGuest}
          onClick={() => changeGuestAccess(!guestAccess)}
        />
      </div>
    </Modal>
  );
}
