// Desktop/web notifications for incoming messages, honoring push rules via
// the SDK's client-side evaluation (getPushActionsForEvent).

import { ClientEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";
import { SyncState } from "matrix-js-sdk";
import { getPrefs } from "./prefs";
import { playSound } from "./sounds";

let requested = false;

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Cache the dynamically-imported Tauri notification module so the web bundle
// never hard-depends on it and desktop only loads it once.
type TauriNotify = typeof import("@tauri-apps/plugin-notification");
let tauriMod: Promise<TauriNotify> | null = null;
function loadTauriNotification(): Promise<TauriNotify> {
  if (!tauriMod) tauriMod = import("@tauri-apps/plugin-notification");
  return tauriMod;
}

async function ensureWebPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (requested) return false;
  requested = true;
  return (await Notification.requestPermission()) === "granted";
}

async function ensureTauriPermission(): Promise<boolean> {
  try {
    const { isPermissionGranted, requestPermission } = await loadTauriNotification();
    if (await isPermissionGranted()) return true;
    if (requested) return false;
    requested = true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

async function ensurePermission(): Promise<boolean> {
  return isTauri ? ensureTauriPermission() : ensureWebPermission();
}

/** Wire notification dispatch for one client. Returns an unsubscribe. */
export function wireNotifications(
  client: MatrixClient,
  onActivate: (roomId: string) => void,
  isMuted: (roomId: string) => boolean,
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
    if (isMuted(room.roomId)) return;
    const actions = client.getPushActionsForEvent(ev);
    if (!actions?.notify) return;

    // Sound plays even if OS notification permission is denied.
    playSound(getPrefs().sound);

    if (!(await ensurePermission())) return;

    // Privacy mode "name": never include content, only who wrote.
    let body = "New message";
    if (mode === "preview" && !ev.isBeingDecrypted() && !ev.isDecryptionFailure()) {
      const content = ev.getContent();
      body = typeof content.body === "string" ? content.body.slice(0, 140) : "New message";
    }
    const sender = room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender() ?? "";
    const title = room.name === sender ? sender : `${sender} · ${room.name}`;

    if (isTauri) {
      try {
        const { sendNotification } = await loadTauriNotification();
        // roomId travels in `extra` so the click listener can focus the room.
        sendNotification({ title, body, group: room.roomId, extra: { roomId: room.roomId } });
      } catch {
        // Plugin unavailable; the sound above still fired.
      }
      return;
    }

    try {
      const n = new Notification(title, { body, tag: `${room.roomId}` });
      n.onclick = () => {
        window.focus();
        onActivate(room.roomId);
        n.close();
      };
    } catch {
      // Web Notification unsupported; ignore.
    }
  };

  // On desktop, route a clicked/actioned notification back to its room. Click
  // activation is best-effort: the plugin surfaces it on platforms that report
  // it, and no-ops elsewhere. Registration is async, so hold a handle to
  // unregister on teardown.
  let actionListener: { unregister: () => void } | null = null;
  let disposed = false;
  if (isTauri) {
    loadTauriNotification()
      .then(({ onAction }) =>
        onAction((notification) => {
          const roomId = (notification.extra as { roomId?: string } | undefined)?.roomId;
          if (roomId) onActivate(roomId);
        }),
      )
      .then((listener) => {
        if (disposed) listener.unregister();
        else actionListener = listener;
      })
      .catch(() => {
        // onAction not supported on this platform; notifications still show.
      });
  }

  client.on(ClientEvent.Sync, onSync);
  client.on(RoomEvent.Timeline, onEvent as never);
  return () => {
    disposed = true;
    actionListener?.unregister();
    client.off(ClientEvent.Sync, onSync);
    client.off(RoomEvent.Timeline, onEvent as never);
  };
}
