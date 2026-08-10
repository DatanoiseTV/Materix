import { describe, it, expect } from "vitest";
import type { MatrixEvent } from "matrix-js-sdk";
import { lastReceiptableEvent } from "./readReceipt";

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
