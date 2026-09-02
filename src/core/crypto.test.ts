import { describe, it, expect } from "vitest";
import { CryptoFacade } from "./crypto";

// Regression test for the cross-account secret-storage leak: the ssKeyCache and
// pending recovery key are per-CryptoFacade (per account), so a key cached on
// one account must never be returned to another account's crypto callbacks.
describe("CryptoFacade cryptoCallbacks — per-account isolation", () => {
  const keys = { kid: {} };

  it("keeps a cached secret-storage key private to the account that cached it", async () => {
    const a = new CryptoFacade("@a:example.org");
    const b = new CryptoFacade("@b:example.org");
    const key = new Uint8Array([1, 2, 3, 4]);

    a.cryptoCallbacks.cacheSecretStorageKey("kid", {}, key);

    // The account that cached it can read it back...
    expect(await a.cryptoCallbacks.getSecretStorageKey({ keys })).toEqual(["kid", key]);
    // ...a different account cannot (separate cache — no cross-account leak).
    expect(await b.cryptoCallbacks.getSecretStorageKey({ keys })).toBeNull();
  });

  it("returns null when nothing is cached and no recovery key is pending", async () => {
    const a = new CryptoFacade("@a:example.org");
    expect(await a.cryptoCallbacks.getSecretStorageKey({ keys })).toBeNull();
  });

  it("gives each account its own callbacks object", () => {
    const a = new CryptoFacade("@a:example.org");
    const b = new CryptoFacade("@b:example.org");
    expect(a.cryptoCallbacks).not.toBe(b.cryptoCallbacks);
  });
});
