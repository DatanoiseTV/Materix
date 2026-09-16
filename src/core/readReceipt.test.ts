import { describe, it, expect } from "vitest";
import type { MatrixEvent } from "matrix-js-sdk";
import { lastReceiptableEvent, receiptIncludesUser } from "./readReceipt";

// Minimal MatrixEvent stand-in: lastReceiptableEvent only reads getId() + status.
const ev = (id: string | undefined, status: unknown): MatrixEvent =>
  ({ getId: () => id, status }) as unknown as MatrixEvent;

describe("lastReceiptableEvent", () => {
  it("skips a FAILED local echo at the tail (the read-receipt 400-loop regression)", () => {
    const events = [ev("$sent", null), ev("~!room:txn", "not_sent")];
    expect(lastReceiptableEvent(events)?.getId()).toBe("$sent");
  });

  it("skips a still-sending local echo at the tail", () => {
    const events = [ev("$sent", null), ev("~!room:txn", "sending")];
    expect(lastReceiptableEvent(events)?.getId()).toBe("$sent");
  });

  it("targets the newest fully-sent event", () => {
    expect(lastReceiptableEvent([ev("$a", null), ev("$b", null)])?.getId()).toBe(
      "$b",
    );
  });

  it("returns undefined when nothing is fully sent", () => {
    expect(lastReceiptableEvent([ev("~!room:txn", "sending")])).toBeUndefined();
    expect(lastReceiptableEvent([ev(undefined, null)])).toBeUndefined();
    expect(lastReceiptableEvent([])).toBeUndefined();
  });
});

// receiptIncludesUser gates the room-list re-render: it must return true iff MY
// receipt is in the event, so the list only re-summarizes when my unread count
// could have changed — never for another member's read marker.
const me = "@me:hs";
describe("receiptIncludesUser", () => {
  it("detects my m.read receipt", () => {
    const content = { $evA: { "m.read": { [me]: { ts: 1 } } } };
    expect(receiptIncludesUser(content, me)).toBe(true);
  });

  it("detects my private read receipt under a different receipt type", () => {
    const content = { $evA: { "m.read.private": { [me]: { ts: 1 } } } };
    expect(receiptIncludesUser(content, me)).toBe(true);
  });

  it("detects me even when other users share the same event/type", () => {
    const content = { $evA: { "m.read": { "@other:hs": { ts: 1 }, [me]: { ts: 2 } } } };
    expect(receiptIncludesUser(content, me)).toBe(true);
  });

  it("is false when only other users have receipts (the common busy-room case)", () => {
    const content = {
      $evA: { "m.read": { "@a:hs": { ts: 1 }, "@b:hs": { ts: 2 } } },
      $evB: { "m.read.private": { "@c:hs": { ts: 3 } } },
    };
    expect(receiptIncludesUser(content, me)).toBe(false);
  });

  it("is false for empty or malformed content instead of throwing", () => {
    expect(receiptIncludesUser({}, me)).toBe(false);
    expect(receiptIncludesUser(null, me)).toBe(false);
    expect(receiptIncludesUser(undefined, me)).toBe(false);
    expect(receiptIncludesUser({ $evA: null }, me)).toBe(false);
    expect(receiptIncludesUser({ $evA: { "m.read": 42 } }, me)).toBe(false);
  });

  it("does not match a user id that only appears as an event id or receipt type", () => {
    // me sitting in the eventId / receiptType position must not count — only a
    // real receipt (userId key with an object value) does.
    const content = { [me]: { [me]: "notanobject" } };
    expect(receiptIncludesUser(content, me)).toBe(false);
  });
});
