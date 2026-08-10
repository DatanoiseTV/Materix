import type { MatrixEvent } from "matrix-js-sdk";

/**
 * The newest timeline event a read receipt may safely target: the latest
 * *fully-sent* event.
 *
 * A local echo — a message still sending, or one that failed to send — also
 * carries an id (a pending "~roomId:txnId") but has a non-null `status`.
 * Sending an `m.read` receipt for such an event is rejected by the server with
 * 400, and because `markRead()` runs on every timeline update, a single failed
 * message sitting at the tail would loop indefinitely, hammering the homeserver.
 * So skip anything that is not fully sent (id present, not a "~" local id, and
 * `status === null`).
 */
export function lastReceiptableEvent(
  events: readonly MatrixEvent[],
): MatrixEvent | undefined {
  return [...events].reverse().find((e) => {
    const id = e.getId();
    return !!id && !id.startsWith("~") && e.status === null;
  });
}
