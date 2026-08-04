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
  private call: MatrixCall | null = null;
  private videoCall = false;
  private answered = false;
  private startedAt: number | null = null;
  private error: string | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private snap: CallSnapshot = IDLE;

  /** Wire the incoming-call listener. Call once, after the client exists. */
  bind(client: MatrixClient): void {
    this.client = client;
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
    }
    if (state === CallState.Ended) {
      this.finish();
      return;
    }
    this.publish();
  };

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
