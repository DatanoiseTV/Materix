// E2EE facade: SAS verification flows, key backup / recovery, device list.
// Wraps matrix-js-sdk's CryptoApi behind UI-facing types (docs/api-contract.md).

import type { MatrixClient } from "matrix-js-sdk";
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
} from "matrix-js-sdk/lib/crypto-api";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent";
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
      if (keyId) return [keyId, pendingRecoveryKey];
    }
    return null;
  },
  cacheSecretStorageKey: (keyId: string, _info: unknown, key: Uint8Array): void => {
    ssKeyCache.set(keyId, key as Uint8Array<ArrayBuffer>);
  },
};

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
  }

  private track(req: VerificationRequest): SasFlowImpl {
    const flow = new SasFlowImpl(req, this.accountKey, () => {
      this.events.emit("flows");
      if (flow.phase === "done" || flow.phase === "cancelled") {
        // Keep terminal flows visible briefly; UI dismisses them.
        setTimeout(() => {
          this.flows.delete(flow.flowId);
          this.events.emit("flows");
        }, 15_000);
      }
    });
    this.flows.set(flow.flowId, flow);
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
      // Loads cross-signing + backup secrets from 4S using the pending key.
      await crypto.bootstrapCrossSigning({});
      await crypto.bootstrapSecretStorage({});
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
}

class SasFlowImpl implements SasFlow {
  readonly flowId: string;
  private sasCallbacks: ShowSasCallbacks | null = null;
  private verifierAttached = false;
  cancelReason?: string;

  constructor(
    private req: VerificationRequest,
    public accountKey: string,
    private onChange: () => void,
  ) {
    this.flowId = `${accountKey}-${req.transactionId ?? Math.random().toString(36).slice(2)}`;
    req.on(VerificationRequestEvent.Change, () => this.step());
    this.step();
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
    if (this.req.phase === VerificationPhase.Ready && this.req.initiatedByMe) {
      void this.beginSas();
    }
    if (this.req.phase === VerificationPhase.Started && !this.verifierAttached && this.req.verifier) {
      this.attachVerifier();
    }
    if (this.req.phase === VerificationPhase.Cancelled) {
      this.cancelReason = this.req.cancellationCode ?? undefined;
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
    await this.sasCallbacks?.confirm();
  }

  async cancel(): Promise<void> {
    if (this.sasCallbacks) this.sasCallbacks.mismatch();
    else await this.req.cancel();
  }
}
