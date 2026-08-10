// Matrix HTTP pusher registration for UnifiedPush background delivery.
//
// Background push on de-Googled Android (no Google Play / FCM): a UnifiedPush
// distributor app on the device (e.g. the ntfy app from F-Droid) hands us an
// *endpoint* URL — a topic on a push server. We register that endpoint as a
// Matrix HTTP pusher whose gateway is that same push server's built-in Matrix
// Push Gateway (`/_matrix/push/v1/notify`). The homeserver then POSTs
// new-message notifications to the gateway, which publishes to the endpoint's
// topic; the distributor wakes Materix, which syncs and shows the notification.
//
//   homeserver ──/_matrix/push/v1/notify──▶ ntfy (gateway) ──topic──▶
//        ntfy distributor app ──broadcast──▶ Materix (UnifiedPush receiver)
//
// This module is pure matrix-js-sdk (no native, no DOM) so it stays
// unit-testable and safe to import anywhere.

import type { MatrixClient } from "matrix-js-sdk";

/** app_id namespacing our pushers so we never read/remove another client's. */
export const PUSH_APP_ID = "org.materix.app.unifiedpush";

/**
 * Derive the ntfy Matrix Push Gateway URL from a UnifiedPush endpoint.
 *
 * ntfy exposes the gateway at `<origin>/_matrix/push/v1/notify` on the very
 * server the endpoint (topic) lives on, so the endpoint's origin is all we
 * need — no separate gateway to configure in the common case.
 *
 *   https://ntfy.sh/UPabc123?up=1  →  https://ntfy.sh/_matrix/push/v1/notify
 */
export function gatewayUrlForEndpoint(endpoint: string): string {
  const u = new URL(endpoint);
  return `${u.origin}/_matrix/push/v1/notify`;
}

export interface PusherConfig {
  /** The UnifiedPush endpoint (topic URL) from the distributor. */
  endpoint: string;
  /** Override the derived gateway — advanced setups with a separate push
   *  gateway (e.g. a standalone Sygnal/UnifiedPush gateway). Empty = derive. */
  gatewayUrl?: string;
  /** Shown in the homeserver's device/pusher list (e.g. "Materix · Pixel"). */
  deviceDisplayName: string;
}

/**
 * Register (idempotently) a UnifiedPush HTTP pusher on this client.
 *
 * `append: false` replaces any existing pusher with the same pushkey+app_id, so
 * re-registering after an endpoint rotation cleanly supersedes the old one.
 * `format: "event_id_only"` keeps the gateway payload free of message content —
 * only the event/room id travels through ntfy; the app fetches and decrypts on
 * wake, so nothing sensitive is exposed to the push server.
 */
export async function registerUnifiedPushPusher(
  client: MatrixClient,
  cfg: PusherConfig,
): Promise<void> {
  const gateway = cfg.gatewayUrl?.trim() || gatewayUrlForEndpoint(cfg.endpoint);
  await client.setPusher({
    kind: "http",
    app_id: PUSH_APP_ID,
    pushkey: cfg.endpoint,
    app_display_name: "Materix",
    device_display_name: cfg.deviceDisplayName,
    lang: "en",
    data: {
      url: gateway,
      format: "event_id_only",
    },
    append: false,
  });
}

/** Remove every UnifiedPush pusher we own from this account (disable / logout). */
export async function removeUnifiedPushPushers(client: MatrixClient): Promise<void> {
  const res = await client.getPushers();
  const ours = (res?.pushers ?? []).filter((p) => p.app_id === PUSH_APP_ID);
  for (const p of ours) {
    await client.removePusher(p.pushkey, p.app_id);
  }
}

/** True if this account already has our pusher registered for `endpoint`. */
export async function hasUnifiedPushPusher(
  client: MatrixClient,
  endpoint: string,
): Promise<boolean> {
  const res = await client.getPushers();
  return (res?.pushers ?? []).some((p) => p.app_id === PUSH_APP_ID && p.pushkey === endpoint);
}
