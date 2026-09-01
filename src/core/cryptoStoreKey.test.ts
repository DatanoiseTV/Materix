// Exercises the crypto round-trips of cryptoStoreKey through the real WebCrypto
// (globalThis.crypto.subtle) and the secret store the module uses on web. There
// is no `window` in the node test env, so storage.secret* takes the non-Tauri
// path and reads/writes localStorage — which we back with a tiny in-memory shim
// below. No OS keychain is touched.

import { describe, it, expect, beforeEach } from "vitest";

// Minimal in-memory localStorage: only the methods storage.ts uses.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import {
  createStorageKey,
  readStorageKey,
  hasPasscode,
  setPasscode,
  clearPasscode,
  type PasscodePrompt,
} from "./cryptoStoreKey";

const ACCT = "@alice:example.org";

// A prompt that yields a fixed sequence of answers, then null (cancel), and
// records every ctx it was called with so retry behaviour can be asserted.
function scriptedPrompt(answers: (string | null)[]): PasscodePrompt & { calls: { retry: boolean }[] } {
  const calls: { retry: boolean }[] = [];
  let i = 0;
  const fn = (async (ctx: { accountKey: string; retry: boolean }) => {
    calls.push({ retry: ctx.retry });
    return i < answers.length ? answers[i++] : null;
  }) as PasscodePrompt & { calls: { retry: boolean }[] };
  fn.calls = calls;
  return fn;
}

beforeEach(() => {
  localStorage.clear();
});

describe("createStorageKey", () => {
  it("creates and persists a fresh 32-byte key", async () => {
    const key = await createStorageKey(ACCT);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("is idempotent: a second call returns the identical persisted key", async () => {
    const first = await createStorageKey(ACCT);
    const second = await createStorageKey(ACCT);
    expect([...second]).toEqual([...first]);
  });

  it("gives different accounts independent keys", async () => {
    const a = await createStorageKey("@a:x");
    const b = await createStorageKey("@b:x");
    expect([...a]).not.toEqual([...b]);
  });
});

describe("readStorageKey (plain key)", () => {
  it("returns null for an account with no stored key", async () => {
    expect(await readStorageKey("@nobody:x")).toBeNull();
  });

  it("round-trips the plain base64 key created by createStorageKey", async () => {
    const created = await createStorageKey(ACCT);
    const read = await readStorageKey(ACCT);
    expect(read).not.toBeNull();
    expect([...read!]).toEqual([...created]);
  });

  it("does not invoke the prompt for a plain key", async () => {
    await createStorageKey(ACCT);
    const prompt = scriptedPrompt([]);
    const read = await readStorageKey(ACCT, prompt);
    expect(read).not.toBeNull();
    expect(prompt.calls).toHaveLength(0);
  });
});

describe("passcode wrap/unwrap round-trip (PBKDF2 + AES-GCM)", () => {
  it("setPasscode then readStorageKey with the correct passcode returns the original bytes", async () => {
    const key = await createStorageKey(ACCT);
    await setPasscode(ACCT, key, "correct horse");

    const prompt = scriptedPrompt(["correct horse"]);
    const unwrapped = await readStorageKey(ACCT, prompt);

    expect(unwrapped).not.toBeNull();
    expect([...unwrapped!]).toEqual([...key]);
    expect(prompt.calls).toEqual([{ retry: false }]);
  });

  it("hasPasscode reflects whether the stored record is passcode-wrapped", async () => {
    const key = await createStorageKey(ACCT);
    expect(await hasPasscode(ACCT)).toBe(false); // plain
    await setPasscode(ACCT, key, "s3cret");
    expect(await hasPasscode(ACCT)).toBe(true);
  });

  it("a wrong passcode fails GCM auth, re-prompts with retry=true, then cancels to null", async () => {
    const key = await createStorageKey(ACCT);
    await setPasscode(ACCT, key, "the-real-one");

    // First answer is wrong (GCM auth failure), second is a cancel (null).
    const prompt = scriptedPrompt(["wrong", null]);
    const result = await readStorageKey(ACCT, prompt);

    expect(result).toBeNull();
    expect(prompt.calls).toEqual([{ retry: false }, { retry: true }]);
  });

  it("recovers on a retry: wrong passcode first, correct passcode second", async () => {
    const key = await createStorageKey(ACCT);
    await setPasscode(ACCT, key, "the-real-one");

    const prompt = scriptedPrompt(["nope", "the-real-one"]);
    const result = await readStorageKey(ACCT, prompt);

    expect(result).not.toBeNull();
    expect([...result!]).toEqual([...key]);
    expect(prompt.calls).toEqual([{ retry: false }, { retry: true }]);
  });

  it("returns null immediately when there is no prompt available to unlock", async () => {
    const key = await createStorageKey(ACCT);
    await setPasscode(ACCT, key, "x");
    expect(await readStorageKey(ACCT, undefined)).toBeNull();
  });

  it("returns null when the prompt cancels on the first ask", async () => {
    const key = await createStorageKey(ACCT);
    await setPasscode(ACCT, key, "x");
    const prompt = scriptedPrompt([null]);
    expect(await readStorageKey(ACCT, prompt)).toBeNull();
    expect(prompt.calls).toEqual([{ retry: false }]);
  });

  it("a replaced passcode unlocks with the new value, not the old one", async () => {
    const key = await createStorageKey(ACCT);
    await setPasscode(ACCT, key, "first");
    await setPasscode(ACCT, key, "second");

    const oldThenCancel = scriptedPrompt(["first", null]);
    expect(await readStorageKey(ACCT, oldThenCancel)).toBeNull();

    const newPass = scriptedPrompt(["second"]);
    const ok = await readStorageKey(ACCT, newPass);
    expect(ok).not.toBeNull();
    expect([...ok!]).toEqual([...key]);
  });
});

describe("clearPasscode", () => {
  it("reverts to a plain key that reads back without a prompt", async () => {
    const key = await createStorageKey(ACCT);
    await setPasscode(ACCT, key, "pass");
    expect(await hasPasscode(ACCT)).toBe(true);

    await clearPasscode(ACCT, key);
    expect(await hasPasscode(ACCT)).toBe(false);

    const prompt = scriptedPrompt([]);
    const read = await readStorageKey(ACCT, prompt);
    expect(read).not.toBeNull();
    expect([...read!]).toEqual([...key]);
    expect(prompt.calls).toHaveLength(0);
  });
});
