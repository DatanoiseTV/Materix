// 1:1 voice/video calls (WebRTC over Matrix). Owns at most one active
// MatrixCall and projects its state into a UI-facing snapshot via an Emitter,
// mirroring the crypto/audio "bind once, push coarse invalidations" pattern.
//
// Contract: docs/api-contract.md "Core boundary". The UI never touches
// matrix-js-sdk directly — it drives calls through this manager's methods and
// reads MediaStreams off the snapshot to attach to <video>/<audio> elements.

import type { MatrixClient } from "matrix-js-sdk";
import {
  CallDirection,
  CallErrorCode,
  CallEvent,
  CallState,
  CallType,
  type CallError,
  type MatrixCall,
} from "matrix-js-sdk/lib/webrtc/call";
import { CallEventHandlerEvent } from "matrix-js-sdk/lib/webrtc/callEventHandler";
import { Emitter } from "./emitter";

export type CallStatus =
  | "idle"
  | "incoming"
  | "outgoing"
  | "connecting"
  | "connected"
  | "ended";

export interface CallSnapshot {
  status: CallStatus;
  roomId: string | null;
  /** The other party (best-effort; may resolve from ringing to connected). */
  peerId: string | null;
  peerName: string | null;
  peerAvatarMxc: string | null;
  isVideo: boolean;
  micMuted: boolean;
  videoMuted: boolean;
  /**
   * Whether the call's *signaling* is end-to-end encrypted, i.e. the room is
   * E2EE so the SDP/ICE exchange (and the DTLS fingerprints that authenticate
   * the media) travel over Olm/Megolm. The media itself is always DTLS-SRTP
   * encrypted peer-to-peer regardless; this flag is the stronger guarantee.
   */
  encrypted: boolean;
  /**
   * How the media is actually flowing once connected, from the selected ICE
   * candidate pair: "direct" (host/STUN — peer-to-peer) or "relay" (routed
   * through a TURN server, so it is not P2P). Null until known / not connected.
   */
  mediaPath: "direct" | "relay" | null;
  /** ms epoch when the call first reached "connected", for the call timer. */
  startedAt: number | null;
  /** Human-readable reason the call ended in error, else null. */
  error: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

const IDLE: CallSnapshot = {
  status: "idle",
  roomId: null,
  peerId: null,
  peerName: null,
  peerAvatarMxc: null,
  isVideo: false,
  micMuted: false,
  videoMuted: false,
  encrypted: false,
  mediaPath: null,
  startedAt: null,
  error: null,
  localStream: null,
  remoteStream: null,
};

/** How long the "ended" surface lingers before the overlay auto-dismisses. */
const ENDED_LINGER_MS = 2500;

export class CallManager {
  readonly events = new Emitter<"call">();

  private client!: MatrixClient;
  /** Whether the E2EE crypto engine is up (see MatrixAccount.cryptoAvailable);
   *  read at call time because crypto init finishes after bind(). */
  private cryptoAvailable: () => boolean = () => true;
  private call: MatrixCall | null = null;
  private videoCall = false;
  private answered = false;
  private startedAt: number | null = null;
  private error: string | null = null;
  private mediaPath: "direct" | "relay" | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private snap: CallSnapshot = IDLE;

  /** Wire the incoming-call listener. Call once, after the client exists. */
  bind(client: MatrixClient, cryptoAvailable?: () => boolean): void {
    this.client = client;
    if (cryptoAvailable) this.cryptoAvailable = cryptoAvailable;
    client.on(CallEventHandlerEvent.Incoming, this.onIncoming);
  }

  snapshot(): CallSnapshot {
    return this.snap;
  }

  // ----- outbound -------------------------------------------------------

  async startVoiceCall(roomId: string): Promise<void> {
    await this.place(roomId, false);
  }

  async startVideoCall(roomId: string): Promise<void> {
    await this.place(roomId, true);
  }

  private async place(roomId: string, video: boolean): Promise<void> {
    if (this.isBusy()) throw new Error("A call is already in progress.");
    assertGetUserMedia();
    // In an E2EE room the call signaling (m.call.* invite/answer/candidates,
    // carrying the SDP and the DTLS fingerprints) rides Olm/Megolm like any
    // other event. Without a working crypto engine (old-WebView WASM failure)
    // the SDK can't encrypt the invite — and could never decrypt the peer's
    // answer — so fail up front with an actionable message instead of the
    // SDK's cryptic send error. Calls in unencrypted rooms still work.
    if (!this.cryptoAvailable() && this.client.getRoom(roomId)?.hasEncryptionStateEvent()) {
      throw new Error(
        "This room is end-to-end encrypted, but encryption is unavailable on this device " +
          "(its System WebView is too old to run the crypto engine), so the call can't be " +
          "set up here. Calls in unencrypted rooms still work.",
      );
    }
    const call = this.client.createCall(roomId);
    if (!call) throw new Error("This device does not support calls.");
    this.adopt(call, video);
    try {
      if (video) await call.placeVideoCall();
      else await call.placeVoiceCall();
    } catch (e) {
      // getUserMedia denial / no devices surface here; report and tear down.
      this.error = describeError(e);
      this.hangup();
      throw e instanceof Error ? e : new Error(this.error);
    }
  }

  // ----- inbound --------------------------------------------------------

  private onIncoming = (call: MatrixCall): void => {
    // Only one call at a time: reject a second ring with "busy" so the caller
    // gets a clear signal instead of a silent drop.
    if (this.isBusy()) {
      try {
        call.reject();
      } catch {
        call.hangup(CallErrorCode.UserBusy, true);
      }
      return;
    }
    this.adopt(call, call.type === CallType.Video);
  };

  async answer(): Promise<void> {
    if (!this.call) return;
    this.answered = true;
    this.publish();
    try {
      assertGetUserMedia();
      await this.call.answer(true, this.videoCall);
    } catch (e) {
      this.error = describeError(e);
      this.hangup();
    }
  }

  // ----- in-call controls ----------------------------------------------

  hangup(): void {
    const call = this.call;
    if (!call) return;
    try {
      if (call.state === CallState.Ringing && call.direction === CallDirection.Inbound) {
        call.reject();
      } else {
        call.hangup(CallErrorCode.UserHangup, false);
      }
    } catch {
      // terminate() below still fires via the Hangup/State listeners; if not,
      // force the local teardown.
      this.finish();
    }
  }

  async toggleMute(): Promise<void> {
    if (!this.call) return;
    await this.call.setMicrophoneMuted(!this.call.isMicrophoneMuted());
    this.publish();
  }

  async toggleVideo(): Promise<void> {
    if (!this.call) return;
    await this.call.setLocalVideoMuted(!this.call.isLocalVideoMuted());
    this.publish();
  }

  // ----- wiring ---------------------------------------------------------

  private adopt(call: MatrixCall, video: boolean): void {
    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    this.call = call;
    this.videoCall = video;
    this.answered = false;
    this.startedAt = null;
    this.error = null;
    this.mediaPath = null;

    // An 'error' listener MUST be attached before place*/answer or the SDK
    // throws — attach the full set here.
    call.on(CallEvent.Error, this.onError);
    call.on(CallEvent.State, this.onState);
    call.on(CallEvent.Hangup, this.onHangup);
    call.on(CallEvent.FeedsChanged, this.onFeeds);
    this.publish();
  }

  private onError = (err: CallError): void => {
    this.error = err?.message ?? "Call failed.";
    this.publish();
  };

  private onState = (state: CallState): void => {
    if (state === CallState.Connected && this.startedAt === null) {
      this.startedAt = Date.now();
      this.startStatsPolling();
    }
    if (state === CallState.Ended) {
      this.finish();
      return;
    }
    this.publish();
  };

  /** While connected, poll WebRTC stats to learn whether media is flowing
   * peer-to-peer or via a TURN relay, and reflect it in the snapshot. */
  private startStatsPolling(): void {
    clearInterval(this.statsTimer);
    const tick = () => void this.pollMediaPath();
    tick();
    this.statsTimer = setInterval(tick, 3000);
  }

  private async pollMediaPath(): Promise<void> {
    const pc = this.call?.peerConn;
    if (!pc) return;
    try {
      const path = classifyMediaPath(await pc.getStats());
      if (path && path !== this.mediaPath) {
        this.mediaPath = path;
        this.publish();
      }
    } catch {
      // getStats can reject during teardown; ignore.
    }
  }

  private onHangup = (): void => {
    this.finish();
  };

  private onFeeds = (): void => {
    this.publish();
  };

  /** Detach listeners, surface the terminal "ended" snapshot, then idle out. */
  private finish(): void {
    const call = this.call;
    if (call) this.detach(call);
    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
    this.call = null;
    this.snap = {
      ...this.snap,
      status: "ended",
      localStream: null,
      remoteStream: null,
    };
    this.events.emit("call");
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.snap = IDLE;
      this.startedAt = null;
      this.error = null;
      this.events.emit("call");
    }, ENDED_LINGER_MS);
  }

  private detach(call: MatrixCall): void {
    call.off(CallEvent.Error, this.onError);
    call.off(CallEvent.State, this.onState);
    call.off(CallEvent.Hangup, this.onHangup);
    call.off(CallEvent.FeedsChanged, this.onFeeds);
  }

  private isBusy(): boolean {
    return !!this.call && !this.call.callHasEnded();
  }

  // ----- snapshot projection -------------------------------------------

  private publish(): void {
    const call = this.call;
    if (!call) return;
    this.snap = {
      status: this.deriveStatus(call),
      roomId: call.roomId,
      ...this.peer(call),
      isVideo: this.videoCall,
      micMuted: call.isMicrophoneMuted(),
      videoMuted: call.isLocalVideoMuted(),
      encrypted: this.client.getRoom(call.roomId ?? undefined)?.hasEncryptionStateEvent() ?? false,
      mediaPath: this.mediaPath,
      startedAt: this.startedAt,
      error: this.error,
      localStream: call.localUsermediaStream ?? null,
      remoteStream: call.remoteUsermediaStream ?? null,
    };
    this.events.emit("call");
  }

  private deriveStatus(call: MatrixCall): CallStatus {
    const s = call.state;
    if (s === CallState.Ended) return "ended";
    if (s === CallState.Connected) return "connected";
    if (call.direction === CallDirection.Inbound && !this.answered) {
      return s === CallState.Ringing ? "incoming" : "connecting";
    }
    if (call.direction === CallDirection.Inbound) return "connecting";
    // Outbound: fledgling/wait-media/create-offer/invite-sent read as ringing.
    return s === CallState.Connecting || s === CallState.CreateAnswer
      ? "connecting"
      : "outgoing";
  }

  private peer(call: MatrixCall): Pick<CallSnapshot, "peerId" | "peerName" | "peerAvatarMxc"> {
    const member =
      call.getOpponentMember() ??
      this.client
        .getRoom(call.roomId)
        ?.getJoinedMembers()
        .find((m) => m.userId !== this.client.getUserId());
    if (!member) return { peerId: null, peerName: null, peerAvatarMxc: null };
    return {
      peerId: member.userId,
      peerName: member.name ?? member.userId,
      peerAvatarMxc: member.getMxcAvatarUrl() ?? null,
    };
  }
}

/**
 * Classify the media path from a WebRTC stats report: find the selected ICE
 * candidate pair and check whether either end is a TURN "relay" candidate.
 * Returns "relay" (routed through a TURN server — not peer-to-peer), "direct"
 * (host/STUN pair — P2P), or null if no pair is active yet.
 */
function classifyMediaPath(stats: RTCStatsReport): "direct" | "relay" | null {
  // getStats() typings vary across TS lib versions; index by id via forEach.
  const byId = new Map<string, Record<string, unknown>>();
  stats.forEach((r) => byId.set((r as { id: string }).id, r as Record<string, unknown>));

  let pair: Record<string, unknown> | undefined;
  for (const r of byId.values()) {
    if (r.type === "transport" && typeof r.selectedCandidatePairId === "string") {
      pair = byId.get(r.selectedCandidatePairId) ?? pair;
    }
  }
  if (!pair) {
    for (const r of byId.values()) {
      if (r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) {
        pair = r;
        break;
      }
    }
  }
  if (!pair) return null;

  const local = byId.get(pair.localCandidateId as string);
  const remote = byId.get(pair.remoteCandidateId as string);
  if (!local && !remote) return null;
  const relayed = local?.candidateType === "relay" || remote?.candidateType === "relay";
  return relayed ? "relay" : "direct";
}

/**
 * Throw a clear error when the WebView doesn't expose getUserMedia at all
 * (insecure context / very old engine / missing native plumbing) — the SDK's
 * MediaHandler would otherwise die deep inside with a bare TypeError.
 */
function assertGetUserMedia(): void {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Microphone/camera capture (getUserMedia) is not available in this WebView, " +
        "so calls can't work on this device.",
    );
  }
}

/** Best-effort human message for a getUserMedia / placement failure. */
function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      return "Microphone or camera access was denied.";
    }
    if (e.name === "NotFoundError") return "No microphone or camera was found.";
    return e.message || "Call failed.";
  }
  return "Call failed.";
}
