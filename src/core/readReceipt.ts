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

/**
 * Whether an `m.receipt` event's content carries a receipt from `userId`, under
 * any event id or receipt type (`m.read`, `m.read.private`, `m.fully_read`).
 * Content shape is `{ eventId: { receiptType: { userId: {...} } } }`.
 *
 * Used to decide whether a Receipt event changed *my* room summary: only my own
 * read receipt clears the unread count, so another member's receipt need not
 * re-render the room list (it only moves their read marker in the open
 * timeline). Defensive against malformed content — never throws.
 */
export function receiptIncludesUser(content: unknown, userId: string): boolean {
  if (!content || typeof content !== "object") return false;
  for (const byType of Object.values(content as Record<string, unknown>)) {
    if (!byType || typeof byType !== "object") continue;
    for (const byUser of Object.values(byType as Record<string, unknown>)) {
      if (byUser && typeof byUser === "object" && userId in (byUser as object)) return true;
    }
  }
  return false;
}
