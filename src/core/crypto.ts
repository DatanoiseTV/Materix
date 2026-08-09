// E2EE facade: SAS verification flows, key backup / recovery, device list.
// Wraps matrix-js-sdk's CryptoApi behind UI-facing types (docs/api-contract.md).

import type { MatrixClient } from "matrix-js-sdk";
import {
  ImportRoomKeyStage,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ImportRoomKeyProgressData,
  type ShowSasCallbacks,
  type VerificationRequest,
} from "matrix-js-sdk/lib/crypto-api";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent";
import { decodeBase64, encodeBase64 } from "matrix-js-sdk/lib/base64";
import type { DeviceSummary, KeyBackupStatus, SasFlow, SasPhase } from "./types";
import { Emitter } from "./emitter";
import { toMaterixError } from "./errors";

// In-memory secret-storage key cache, shared across accounts, seeded either by
// bootstrap (cacheSecretStorageKey) or by the user entering a recovery key.
const ssKeyCache = new Map<string, Uint8Array<ArrayBuffer>>();
let pendingRecoveryKey: Uint8Array<ArrayBuffer> | null = null;

export const cryptoCallbacks = {
  getSecretStorageKey: async ({ keys }: { keys: Record<string, unknown> }): Promise<[string, Uint8Array<ArrayBuffer>] | null> => {
    for (const keyId of Object.keys(keys)) {
      const cached = ssKeyCache.get(keyId);
      if (cached) return [keyId, cached];
    }
    if (pendingRecoveryKey) {
      const keyId = Object.keys(keys)[0];
      if (keyId) {
        // Cache the key so secret fetches that happen AFTER restoreWithRecoveryKey
        // returns (Rust crypto imports cross-signing secrets via an async
        // secret-request/gossip cycle) can still read 4S. Without this the device
        // decrypts history but is never cross-signed → verification never completes.
        ssKeyCache.set(keyId, pendingRecoveryKey);
        return [keyId, pendingRecoveryKey];
      }
    }
    return null;
  },
  cacheSecretStorageKey: (keyId: string, _info: unknown, key: Uint8Array): void => {
    ssKeyCache.set(keyId, key as Uint8Array<ArrayBuffer>);
  },
};

// ---------------------------------------------------------------------------
// Encrypted room-key export file ("-----BEGIN MEGOLM SESSION DATA-----").
//
// matrix-js-sdk 41.9.0 no longer ships encryptMegolmKeyFile/decryptMegolmKeyFile
// (they went with the legacy crypto stack), so we reproduce the on-disk format
// here so exports interoperate with Element. Layout of the binary blob:
//   [0]        version = 1
//   [1..17)    16-byte salt
//   [17..33)   16-byte AES-CTR IV
//   [33..37)   PBKDF2 round count, big-endian uint32
//   [37..N-32) AES-256-CTR ciphertext of the UTF-8 JSON
//   [N-32..N)  HMAC-SHA-256 over everything preceding it
// Keys: PBKDF2-SHA-512(passphrase, salt, rounds) -> 512 bits, split into a
// 256-bit AES key and a 256-bit HMAC key.
const MEGOLM_HEADER = "-----BEGIN MEGOLM SESSION DATA-----";
const MEGOLM_TRAILER = "-----END MEGOLM SESSION DATA-----";
const MEGOLM_KDF_ROUNDS = 500_000;

async function deriveMegolmFileKeys(
  salt: Uint8Array<ArrayBuffer>,
  rounds: number,
  passphrase: string,
): Promise<[CryptoKey, CryptoKey]> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-512" }, baseKey, 512),
  );
  const aesKey = await crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-CTR" }, false, [
    "encrypt",
    "decrypt",
  ]);
  const hmacKey = await crypto.subtle.importKey("raw", bits.slice(32, 64), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  return [aesKey, hmacKey];
}

function packMegolmKeyFile(body: Uint8Array): string {
  const b64 = encodeBase64(body);
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return [MEGOLM_HEADER, ...lines, MEGOLM_TRAILER, ""].join("\n");
}

function unpackMegolmKeyFile(fileText: string): Uint8Array<ArrayBuffer> {
  const start = fileText.indexOf(MEGOLM_HEADER);
  if (start < 0) throw new Error("no header");
  const afterHeader = start + MEGOLM_HEADER.length;
  const end = fileText.indexOf(MEGOLM_TRAILER, afterHeader);
  if (end < 0) throw new Error("no trailer");
  const b64 = fileText.slice(afterHeader, end).replace(/\s+/g, "");
  if (!b64) throw new Error("empty body");
  return decodeBase64(b64);
}

async function encryptMegolmKeyFile(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  // Clear the high bit of the counter so a long file can't wrap the 64-bit
  // counter back onto an already-used block (matches Element's exporter).
  iv[8] &= 0x7f;
  const rounds = MEGOLM_KDF_ROUNDS;
  const [aesKey, hmacKey] = await deriveMegolmFileKeys(salt, rounds, passphrase);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CTR", counter: iv, length: 64 },
      aesKey,
      new TextEncoder().encode(plaintext),
    ),
  );

  const body = new Uint8Array(1 + 16 + 16 + 4 + cipher.length + 32);
  let o = 0;
  body[o++] = 1;
  body.set(salt, o);
  o += 16;
  body.set(iv, o);
  o += 16;
  body[o++] = (rounds >>> 24) & 0xff;
  body[o++] = (rounds >>> 16) & 0xff;
  body[o++] = (rounds >>> 8) & 0xff;
  body[o++] = rounds & 0xff;
  body.set(cipher, o);
  o += cipher.length;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, body.subarray(0, o)));
  body.set(mac, o);
  return packMegolmKeyFile(body);
}

async function decryptMegolmKeyFile(fileText: string, passphrase: string): Promise<string> {
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = unpackMegolmKeyFile(fileText);
  } catch {
    throw new Error("This file isn't a Matrix encrypted keys export.");
  }
  if (body.length < 1 + 16 + 16 + 4 + 32 || body[0] !== 1) {
    throw new Error("This file isn't a valid Matrix encrypted keys export.");
  }
  const salt = body.subarray(1, 17);
  const iv = body.subarray(17, 33);
  const rounds = ((body[33] << 24) | (body[34] << 16) | (body[35] << 8) | body[36]) >>> 0;
  const cipher = body.subarray(37, body.length - 32);
  const mac = body.subarray(body.length - 32);
  const [aesKey, hmacKey] = await deriveMegolmFileKeys(salt, rounds, passphrase);
  const ok = await crypto.subtle.verify("HMAC", hmacKey, mac, body.subarray(0, body.length - 32));
  if (!ok) throw new Error("Incorrect passphrase, or the file has been altered.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 64 }, aesKey, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Incorrect passphrase, or the file has been altered.");
  }
}

export class CryptoFacade {
  readonly events = new Emitter<"flows" | "status">();
  private flows = new Map<string, SasFlowImpl>();
  private client!: MatrixClient;

  constructor(private accountKey: string) {}

  /** Inject the client once created (account constructs facade before client). */
  bind(client: MatrixClient): void {
    this.client = client;
  }

  /** Call once after initRustCrypto: hooks incoming verification requests. */
  attach(): void {
    this.client.on(CryptoEvent.VerificationRequestReceived as never, ((req: VerificationRequest) => {
      this.track(req);
    }) as never);
    this.client.on(CryptoEvent.KeysChanged as never, (() => this.events.emit("status")) as never);
    // A successful verification imports the cross-signing + key-backup secrets via
    // an async gossip cycle that finishes SECONDS AFTER the SAS flow reports
    // "done". These fire when that trust / backup state actually flips, so the
    // "Verify this session" banner (which recomputes securityState() on "status")
    // clears on its own instead of lingering until the next app reload.
    this.client.on(CryptoEvent.UserTrustStatusChanged as never, (() => this.events.emit("status")) as never);
    this.client.on(CryptoEvent.KeyBackupStatus as never, (() => this.events.emit("status")) as never);
  }

  private track(req: VerificationRequest): SasFlowImpl {
    const flow = new SasFlowImpl(req, this.accountKey, () => {
      this.events.emit("flows");
      if (flow.phase === "done" || flow.phase === "cancelled") {
        // A completed verification changes this session's security posture, so
        // refresh derived UI (the security banner) at once rather than waiting
        // for the trust-status gossip to arrive.
        if (flow.phase === "done") this.events.emit("status");
        // Keep terminal flows visible briefly; UI dismisses them.
        setTimeout(() => {
          this.flows.delete(flow.flowId);
          this.events.emit("flows");
        }, 15_000);
      }
    });
    this.flows.set(flow.flowId, flow);
    flow.init();
    this.events.emit("flows");
    return flow;
  }

  activeFlows(): SasFlow[] {
    return [...this.flows.values()];
  }

  async startDeviceVerification(userId: string, deviceId: string): Promise<SasFlow> {
    const crypto = this.client.getCrypto()!;
    const req = await crypto.requestDeviceVerification(userId, deviceId);
    return this.track(req);
  }

  /** Verify another user via an in-room request in your DM (the standard Matrix flow). */
  async startUserVerification(userId: string, roomId: string): Promise<SasFlow> {
    const crypto = this.client.getCrypto()!;
    const req = await crypto.requestVerificationDM(userId, roomId);
    return this.track(req);
  }

  /** Whether the other user is cross-signing-verified by us. */
  async userVerified(userId: string): Promise<boolean> {
    const crypto = this.client.getCrypto();
    if (!crypto) return false;
    try {
      const status = await crypto.getUserVerificationStatus(userId);
      return status.isCrossSigningVerified();
    } catch {
      return false;
    }
  }

  /** Verify this session against another of the user's own sessions. */
  async startOwnVerification(): Promise<SasFlow> {
    const crypto = this.client.getCrypto()!;
    const req = await crypto.requestOwnUserVerification();
    return this.track(req);
  }

  async ownDevices(): Promise<DeviceSummary[]> {
    const crypto = this.client.getCrypto();
    if (!crypto) return [];
    const me = this.client.getUserId()!;
    const map = await crypto.getUserDeviceInfo([me]);
    const devices = map.get(me);
    if (!devices) return [];
    const out: DeviceSummary[] = [];
    for (const [deviceId, device] of devices) {
      const status = await crypto.getDeviceVerificationStatus(me, deviceId);
      out.push({
        deviceId,
        displayName: device.displayName,
        verified: !!status?.crossSigningVerified,
        isCurrent: deviceId === this.client.getDeviceId(),
      });
    }
    return out.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.deviceId.localeCompare(b.deviceId));
  }

  async isThisDeviceVerified(): Promise<boolean> {
    const crypto = this.client.getCrypto();
    if (!crypto) return false;
    const status = await crypto.getDeviceVerificationStatus(this.client.getUserId()!, this.client.getDeviceId()!);
    return !!status?.crossSigningVerified;
  }

  async crossSigningReady(): Promise<boolean> {
    const crypto = this.client.getCrypto();
    if (!crypto) return false;
    return crypto.isCrossSigningReady();
  }

  /**
   * Aggregate security state driving the first-run banner:
   * - "needs-setup": account has no cross-signing identity — offer setup.
   * - "needs-verify": identity exists but this session isn't verified — offer
   *   verification against another device or recovery key entry.
   * - "ok" / "unavailable" otherwise.
   */
  async securityState(): Promise<"needs-setup" | "needs-verify" | "ok" | "unavailable"> {
    const crypto = this.client.getCrypto();
    if (!crypto) return "unavailable";
    try {
      const hasIdentity = await crypto.userHasCrossSigningKeys();
      if (!hasIdentity) return "needs-setup";
      const status = await crypto.getDeviceVerificationStatus(
        this.client.getUserId()!,
        this.client.getDeviceId()!,
      );
      return status?.crossSigningVerified ? "ok" : "needs-verify";
    } catch {
      return "unavailable";
    }
  }

  async backupStatus(): Promise<KeyBackupStatus> {
    const crypto = this.client.getCrypto();
    if (!crypto) return { enabled: false, trusted: false };
    const info = await crypto.getKeyBackupInfo();
    const active = await crypto.getActiveSessionBackupVersion();
    return {
      enabled: !!info,
      version: info?.version,
      trusted: active !== null,
    };
  }

  /**
   * First-time security setup: cross-signing + secret storage + key backup.
   * Returns the generated recovery key; it is shown to the user exactly once.
   */
  async setupSecurity(authPassword: string): Promise<string> {
    const crypto = this.client.getCrypto()!;
    let encodedKey: string | undefined;
    try {
      await crypto.bootstrapCrossSigning({
        authUploadDeviceSigningKeys: async (makeRequest) => {
          await makeRequest({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: this.client.getUserId()! },
            password: authPassword,
          });
        },
      });
      await crypto.bootstrapSecretStorage({
        createSecretStorageKey: async () => {
          const key = await crypto.createRecoveryKeyFromPassphrase();
          encodedKey = key.encodedPrivateKey;
          return key;
        },
        setupNewKeyBackup: true,
      });
    } catch (e) {
      throw toMaterixError(e);
    }
    this.events.emit("status");
    if (!encodedKey) throw toMaterixError(new Error("Secret storage already set up on this account."));
    return encodedKey;
  }

  /** Unlock existing secret storage + restore key backup with a recovery key. */
  async restoreWithRecoveryKey(recoveryKey: string): Promise<{ imported: number }> {
    const crypto = this.client.getCrypto()!;
    try {
      pendingRecoveryKey = decodeRecoveryKey(recoveryKey.trim());
    } catch {
      throw toMaterixError(new Error("That doesn't look like a valid recovery key."));
    }
    try {
      // Import cross-signing secrets from 4S and sign this device (the key is now
      // cached by getSecretStorageKey, so any deferred secret fetch also succeeds).
      // NB: no bootstrapSecretStorage here — that's a first-time-setup call and
      // has no place on the restore path.
      await crypto.bootstrapCrossSigning({});
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      const result = await crypto.restoreKeyBackup();
      this.events.emit("status");
      return { imported: result.imported };
    } catch (e) {
      throw toMaterixError(e);
    } finally {
      pendingRecoveryKey = null;
    }
  }

  /**
   * Export every room key this session holds into the Element-compatible,
   * passphrase-encrypted "MEGOLM SESSION DATA" text. Use it to back up
   * encrypted history or move it to another device.
   */
  async exportRoomKeys(passphrase: string): Promise<string> {
    const crypto = this.client.getCrypto();
    if (!crypto) throw toMaterixError(new Error("Encryption isn't available for this account."));
    if (!passphrase) throw toMaterixError(new Error("Choose a passphrase to protect the export."));
    try {
      const json = await crypto.exportRoomKeysAsJson();
      return await encryptMegolmKeyFile(json, passphrase);
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  /**
   * Import room keys from an encrypted "MEGOLM SESSION DATA" file (as produced
   * by exportRoomKeys or Element). Returns how many keys were imported and how
   * many the file contained.
   */
  async importRoomKeys(fileText: string, passphrase: string): Promise<{ imported: number; total: number }> {
    const crypto = this.client.getCrypto();
    if (!crypto) throw toMaterixError(new Error("Encryption isn't available for this account."));
    let json: string;
    try {
      json = await decryptMegolmKeyFile(fileText, passphrase);
    } catch (e) {
      throw toMaterixError(e);
    }
    try {
      let imported = 0;
      let total = 0;
      await crypto.importRoomKeysAsJson(json, {
        progressCallback: (stage: ImportRoomKeyProgressData) => {
          if (stage.stage === ImportRoomKeyStage.LoadKeys) {
            imported = stage.successes;
            total = stage.total;
          }
        },
      });
      this.events.emit("status");
      return { imported, total };
    } catch {
      throw toMaterixError(new Error("That isn't a valid room-keys file."));
    }
  }
}

class SasFlowImpl implements SasFlow {
  readonly flowId: string;
  private sasCallbacks: ShowSasCallbacks | null = null;
  private verifierAttached = false;
  private confirmed = false;
  private timeout?: ReturnType<typeof setTimeout>;
  cancelReason?: string;

  /** How long to wait for a peer to respond before failing an initiated request. */
  private static readonly RESPONSE_TIMEOUT_MS = 120_000;

  constructor(
    private req: VerificationRequest,
    public accountKey: string,
    private onChange: () => void,
  ) {
    this.flowId = `${accountKey}-${req.transactionId ?? Math.random().toString(36).slice(2)}`;
  }

  /** Called by CryptoFacade.track AFTER the flow reference exists, so the
   * onChange closure (which reads the flow) is safe to invoke. */
  init(): void {
    this.req.on(VerificationRequestEvent.Change, () => this.step());
    // If we initiated the request, don't spin forever when no other device
    // responds — cancel with an actionable reason so the UI can recover.
    if (this.req.initiatedByMe) {
      this.timeout = setTimeout(() => {
        const p = this.req.phase;
        if (p === VerificationPhase.Unsent || p === VerificationPhase.Requested || p === VerificationPhase.Ready) {
          this.cancelReason = "No other device responded. Make sure another of your sessions is signed in and online, or verify this session with your recovery key instead.";
          void this.req.cancel().catch(() => undefined);
        }
      }, SasFlowImpl.RESPONSE_TIMEOUT_MS);
    }
    this.step();
  }

  private clearTimer(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }

  get peer(): SasFlow["peer"] {
    return { userId: this.req.otherUserId, deviceId: this.req.otherDeviceId };
  }

  get initiatedByMe(): boolean {
    return this.req.initiatedByMe;
  }

  get emojis(): SasFlow["emojis"] {
    return this.sasCallbacks?.sas.emoji?.map(([symbol, name]) => ({ symbol, name }));
  }

  get phase(): SasPhase {
    switch (this.req.phase) {
      case VerificationPhase.Unsent:
      case VerificationPhase.Requested:
        return "requested";
      case VerificationPhase.Ready:
        return "ready";
      case VerificationPhase.Started:
        if (this.confirmed) return "confirmed";
        return this.sasCallbacks ? "emojis" : "ready";
      case VerificationPhase.Done:
        return "done";
      case VerificationPhase.Cancelled:
        return "cancelled";
      default:
        return "requested";
    }
  }

  /** Drive the state machine forward on every request change. */
  private step(): void {
    // Any real progress (or a terminal state) means we're no longer waiting on
    // an unanswered request, so drop the response timeout.
    if (this.req.phase !== VerificationPhase.Requested && this.req.phase !== VerificationPhase.Unsent) {
      this.clearTimer();
    }
    if (this.req.phase === VerificationPhase.Ready && this.req.initiatedByMe) {
      void this.beginSas();
    }
    if (this.req.phase === VerificationPhase.Started && !this.verifierAttached && this.req.verifier) {
      this.attachVerifier();
    }
    if (this.req.phase === VerificationPhase.Cancelled) {
      // Keep a reason we set ourselves (e.g. the timeout) over the raw code.
      this.cancelReason = this.cancelReason ?? this.req.cancellationCode ?? undefined;
    }
    this.onChange();
  }

  private async beginSas(): Promise<void> {
    if (this.verifierAttached) return;
    this.verifierAttached = true;
    try {
      const verifier = await this.req.startVerification("m.sas.v1");
      verifier.on(VerifierEvent.ShowSas, (sas) => {
        this.sasCallbacks = sas;
        this.onChange();
      });
      await verifier.verify();
    } catch {
      // cancellation surfaces via request phase change
    }
    this.onChange();
  }

  private attachVerifier(): void {
    this.verifierAttached = true;
    const verifier = this.req.verifier!;
    const existing = verifier.getShowSasCallbacks();
    if (existing) this.sasCallbacks = existing;
    verifier.on(VerifierEvent.ShowSas, (sas) => {
      this.sasCallbacks = sas;
      this.onChange();
    });
    void verifier.verify().catch(() => undefined);
  }

  async accept(): Promise<void> {
    await this.req.accept();
  }

  async confirmMatch(): Promise<void> {
    // Reflect "waiting for the other side to confirm" in the UI immediately.
    this.confirmed = true;
    this.onChange();
    await this.sasCallbacks?.confirm();
  }

  async cancel(): Promise<void> {
    this.clearTimer();
    if (this.sasCallbacks) this.sasCallbacks.mismatch();
    else await this.req.cancel();
  }
}
