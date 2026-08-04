// Per-account 32-byte key that encrypts the Rust crypto store at rest (passed
// to initRustCrypto's storageKey). Encrypting the crypto store is what keeps
// megolm/message keys from sitting on disk in the clear.
//
// SAFETY — this is deliberately NON-DESTRUCTIVE: a key is created ONLY when a
// brand-new account logs in (createStorageKey, called from manager.login/
// register), i.e. against a crypto store that does not exist yet. Accounts that
// were already logged in before this feature have no key record, so
// readStorageKey returns null and their crypto init path is unchanged — no
// migration, no prefix change, no store deletion. A previous attempt that reset
// the store bricked decryption; this design cannot, because it never touches an
// existing store.

import { secretGet, secretSet } from "./storage";

const PREFIX = "materix.ckey.";

const toB64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const u = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

/**
 * Create and persist a fresh 32-byte key for an account. Call at LOGIN time,
 * before the client's crypto is initialised, so the fresh store is encrypted.
 * No-op-safe: if a key already exists it is returned unchanged.
 */
export async function createStorageKey(accountKey: string): Promise<Uint8Array<ArrayBuffer>> {
  const existing = await readStorageKey(accountKey);
  if (existing) return existing;
  const key = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(key);
  await secretSet(PREFIX + accountKey, toB64(key));
  return key;
}

/**
 * Return the account's crypto-store key, or null if none was ever created
 * (a legacy account whose store is unencrypted — must stay that way).
 */
export async function readStorageKey(accountKey: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const raw = await secretGet(PREFIX + accountKey);
  if (!raw) return null;
  try {
    const key = fromB64(raw);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
