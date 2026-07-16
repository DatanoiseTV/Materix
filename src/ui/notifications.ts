// Desktop/web notifications for incoming messages, honoring push rules via
// the SDK's client-side evaluation (getPushActionsForEvent).

import { ClientEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { SyncState } from "matrix-js-sdk";
import { getPrefs } from "./prefs";

let requested = false;

async function ensurePermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (requested) return false;
  requested = true;
  return (await Notification.requestPermission()) === "granted";
}

/** Wire notification dispatch for one client. Returns an unsubscribe. */
export function wireNotifications(
  client: MatrixClient,
  onActivate: (roomId: string) => void,
): () => void {
  let ready = false;
  const onSync = (state: SyncState) => {
    // Skip everything from the initial sync; only notify for live events.
    if (state === SyncState.Syncing || state === SyncState.Prepared) ready = true;
  };
  const onEvent = async (ev: MatrixEvent, room: Room | undefined) => {
    const mode = getPrefs().notifications;
    if (mode === "off") return;
    if (!ready || !room) return;
    if (ev.getSender() === client.getUserId()) return;
    if (document.hasFocus()) return;
    const ts = ev.getTs();
    if (Date.now() - ts > 60_000) return; // stale/backfill
    const actions = client.getPushActionsForEvent(ev);
    if (!actions?.notify) return;
    if (!(await ensurePermission())) return;

    // Privacy mode "name": never include content, only who wrote.
    let body = "New message";
    if (mode === "preview" && !ev.isBeingDecrypted() && !ev.isDecryptionFailure()) {
      const content = ev.getContent();
      body = typeof content.body === "string" ? content.body.slice(0, 140) : "New message";
    }
    const sender = room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender() ?? "";
    const title = room.name === sender ? sender : `${sender} · ${room.name}`;
    try {
      const n = new Notification(title, { body, tag: `${room.roomId}` });
      n.onclick = () => {
        window.focus();
        onActivate(room.roomId);
        n.close();
      };
    } catch {
      // Tauri webview may not implement Notification fully; ignore.
    }
  };

  client.on(ClientEvent.Sync, onSync);
  client.on(RoomEvent.Timeline, onEvent as never);
  return () => {
    client.off(ClientEvent.Sync, onSync);
    client.off(RoomEvent.Timeline, onEvent as never);
  };
}
