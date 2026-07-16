// Manages the per-account 32-byte key that encrypts the Rust crypto store at
// rest (passed to initRustCrypto's storageKey). This key — the "master storage
// key" (MSK) — decrypts the megolm session keys that in turn decrypt message
// history, so protecting it is what actually keeps history from leaking on disk.
//
// The MSK is generated once and never changes, so the crypto store stays
// readable. It is persisted in one of two shapes:
//   - "plain":    stored as-is (OS keychain on desktop, localStorage on web).
//                 Seamless, zero friction; strong on desktop, modest on web.
//   - "passcode": the MSK is wrapped with an AES-GCM key derived (PBKDF2) from
//                 a user passcode, and the plaintext MSK is not stored. Strong
//                 everywhere; requires unlocking on launch.
//
// Turning a passcode on or off only re-wraps the same MSK, so the crypto store
// is never invalidated by the change.

import { secretGet, secretSet } from "./storage";

const PREFIX = "materix.ckey.";
// PBKDF2-SHA256 iterations. OWASP (2023) recommends >= 600k for SHA-256.
const ITERATIONS = 600_000;

type KeyRecord =
  | { v: 1; mode: "plain"; key: string }
  | { v: 1; mode: "passcode"; salt: string; iv: string; wrapped: string; iterations: number };

const toB64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const u = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const u = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(u);
  return u;
}

async function deriveWrapKey(
  passcode: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function loadRecord(accountKey: string): Promise<KeyRecord | null> {
  const raw = await secretGet(PREFIX + accountKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as KeyRecord;
  } catch {
    return null;
  }
}

async function saveRecord(accountKey: string, rec: KeyRecord): Promise<void> {
  await secretSet(PREFIX + accountKey, JSON.stringify(rec));
}

/** Prompt for a passcode; return the entered value, or null to cancel. */
export type PasscodePrompt = (ctx: { accountKey: string; retry: boolean }) => Promise<string | null>;

// The UI registers a prompt at startup; account init uses it to unlock a
// passcode-protected crypto store without the core layer importing the UI.
let registeredPrompt: PasscodePrompt | undefined;
export function registerPasscodePrompt(fn: PasscodePrompt | undefined): void {
  registeredPrompt = fn;
}
export function getRegisteredPasscodePrompt(): PasscodePrompt | undefined {
  return registeredPrompt;
}

export async function hasPasscode(accountKey: string): Promise<boolean> {
  return (await loadRecord(accountKey))?.mode === "passcode";
}

/**
 * Resolve the 32-byte crypto-store key for an account, generating and
 * persisting a fresh one (plain) on first use. When a passcode is set, `prompt`
 * is called to unlock the MSK and is retried until the correct passcode is
 * entered or the user cancels.
 *
 * Returns both the key and the unlocked MSK (identical bytes) so callers can
 * re-wrap it later (enable/disable passcode) without a second unlock.
 */
export async function getCryptoStoreKey(
  accountKey: string,
  prompt?: PasscodePrompt,
): Promise<Uint8Array<ArrayBuffer>> {
  const rec = await loadRecord(accountKey);
  if (!rec) {
    const key = randomBytes(32);
    await saveRecord(accountKey, { v: 1, mode: "plain", key: toB64(key) });
    return key;
  }
  if (rec.mode === "plain") return fromB64(rec.key);

  const salt = fromB64(rec.salt);
  const iv = fromB64(rec.iv);
  const wrapped = fromB64(rec.wrapped);
  for (let retry = false; ; retry = true) {
    if (!prompt) throw new Error("A passcode is required to unlock this account.");
    const pass = await prompt({ accountKey, retry });
    if (pass == null) throw new Error("Passcode entry cancelled.");
    try {
      const wk = await deriveWrapKey(pass, salt, rec.iterations);
      const msk = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wk, wrapped);
      return new Uint8Array(msk);
    } catch {
      // Wrong passcode (GCM auth failure): loop and prompt again.
    }
  }
}

/** Enable or replace a passcode by re-wrapping the (already unlocked) MSK. */
export async function setPasscode(
  accountKey: string,
  msk: Uint8Array<ArrayBuffer>,
  passcode: string,
): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wk = await deriveWrapKey(passcode, salt, ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wk, msk));
  await saveRecord(accountKey, {
    v: 1,
    mode: "passcode",
    salt: toB64(salt),
    iv: toB64(iv),
    wrapped: toB64(wrapped),
    iterations: ITERATIONS,
  });
}

/** Disable the passcode: store the MSK plain again (still keychain-backed on desktop). */
export async function clearPasscode(accountKey: string, msk: Uint8Array): Promise<void> {
  await saveRecord(accountKey, { v: 1, mode: "plain", key: toB64(msk) });
}
