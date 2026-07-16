import { useState } from "react";
import type { RoomHandle } from "../../core/roomHandle";
import { Modal } from "../components/Modal";
import { IconLocation } from "../components/Icons";
import { useToast } from "../components/Toast";
import { liveShare } from "../liveShare";

const MIN = 60_000;
const DURATIONS: [string, number][] = [
  ["15 minutes", 15 * MIN],
  ["1 hour", 60 * MIN],
  ["8 hours", 8 * 60 * MIN],
];

export function LocationDialog({
  handle,
  accountKey,
  onClose,
}: {
  handle: RoomHandle;
  accountKey: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { showError } = useToast();

  function sendCurrent() {
    if (!navigator.geolocation) {
      showError(new Error("Location isn't available on this device."));
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handle
          .sendLocation(pos.coords.latitude, pos.coords.longitude)
          .catch(showError)
          .finally(() => {
            setBusy(false);
            onClose();
          });
      },
      () => {
        showError(new Error("Couldn't get your location. Check permissions."));
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function shareLive(durationMs: number) {
    setBusy(true);
    try {
      const stop = await handle.startLiveLocation(durationMs);
      liveShare.add(accountKey, handle.roomId, stop, durationMs);
      onClose();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Share location" onClose={onClose}>
      <button className="btn primary" disabled={busy} onClick={sendCurrent}>
        <IconLocation size={16} /> Send my current location
      </button>
      <div className="settings-section">
        <h3>Share live location for…</h3>
        {DURATIONS.map(([label, ms]) => (
          <button key={label} className="btn secondary" disabled={busy} onClick={() => shareLive(ms)}>
            {label}
          </button>
        ))}
        <div className="field-hint">
          Others will see your location update in real time until the timer ends or you stop sharing.
        </div>
      </div>
    </Modal>
  );
}
