// App-level call surface, rendered above every pane so a call shows over any
// room (and even when no room is open). Reads the single active call off the
// core CallManager via useActiveCall and drives it through the account's
// `calls` methods — the UI never touches matrix-js-sdk directly.

import { useEffect, useRef } from "react";
import type { MatrixAccount } from "../../core/account";
import type { CallSnapshot } from "../../core/calls";
import { useActiveCall, useClock } from "../hooks";
import { startRingback, startRingtone } from "../sounds";
import { Avatar } from "./Avatar";
import {
  IconLock,
  IconMic,
  IconMicOff,
  IconPhone,
  IconPhoneOff,
  IconShieldCheck,
  IconVideo,
  IconVideoOff,
} from "./Icons";

/** Honest call-encryption badge. 1:1 WebRTC media is always DTLS-SRTP
 * encrypted peer-to-peer; an E2EE room additionally protects the signaling
 * (and the DTLS fingerprints), which is the stronger end-to-end guarantee. */
function CallEncryption({ encrypted }: { encrypted: boolean }) {
  return encrypted ? (
    <div
      className="call-encryption e2e"
      title="End-to-end encrypted: the call media (DTLS-SRTP) and the call setup are encrypted, so the homeserver can't listen in."
    >
      <IconShieldCheck size={13} />
      <span>End-to-end encrypted</span>
    </div>
  ) : (
    <div
      className="call-encryption"
      title="The call media is encrypted in transit (DTLS-SRTP), but the call setup is not end-to-end encrypted because this room isn't encrypted."
    >
      <IconLock size={13} />
      <span>Encrypted media</span>
    </div>
  );
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function CallOverlay() {
  const active = useActiveCall();
  if (!active) return null;
  return <CallSurface account={active.account} snap={active.snap} />;
}

function CallSurface({ account, snap }: { account: MatrixAccount; snap: CallSnapshot }) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const now = useClock(1000);

  const { status, isVideo } = snap;
  const showVideoStage = isVideo && (status === "connected" || status === "connecting");

  // Attach the remote stream to the visible sink: the <video> for a video call,
  // the hidden <audio> for voice. Local preview is always muted (no echo).
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = snap.remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = snap.remoteStream;
  }, [snap.remoteStream, showVideoStage]);
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = snap.localStream;
  }, [snap.localStream, showVideoStage]);

  // Ring while the call is pending: a distinct incoming ringtone for voice vs
  // video, or a shared ringback while we're the ones calling. The cleanup stops
  // the loop the moment the call is answered, connects, or ends.
  useEffect(() => {
    if (status === "incoming") return startRingtone(isVideo ? "video" : "voice");
    if (status === "outgoing") return startRingback();
  }, [status, isVideo]);

  const name = snap.peerName ?? "Unknown";
  const calls = account.calls;

  const statusLine =
    status === "incoming"
      ? isVideo
        ? "Incoming video call"
        : "Incoming voice call"
      : status === "outgoing"
        ? "Calling…"
        : status === "connecting"
          ? "Connecting…"
          : status === "connected"
            ? snap.startedAt
              ? fmtDuration(now - snap.startedAt)
              : "Connected"
            : snap.error
              ? snap.error
              : "Call ended";

  // Incoming ring: compact prompt with accept / decline.
  if (status === "incoming") {
    return (
      <div className="call-overlay call-overlay-prompt" role="dialog" aria-label="Incoming call">
        <div className="call-card">
          <Avatar account={account} mxc={snap.peerAvatarMxc ?? undefined} name={name} id={snap.peerId ?? name} size={72} />
          <div className="call-peer-name">{name}</div>
          <div className="call-status">{statusLine}</div>
          <CallEncryption encrypted={snap.encrypted} />
          <div className="call-actions">
            <button className="call-btn decline" onClick={() => calls.hangup()} aria-label="Decline call">
              <IconPhoneOff size={24} />
            </button>
            <button className="call-btn accept" onClick={() => void calls.answer()} aria-label="Accept call">
              <IconPhone size={24} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Full in-call surface (outgoing / connecting / connected / ended).
  return (
    <div className="call-overlay call-overlay-active" role="dialog" aria-label="Call">
      <div className={`call-stage${showVideoStage ? " has-video" : ""}`}>
        {showVideoStage ? (
          <>
            <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
            {snap.localStream && !snap.videoMuted && (
              <video ref={localVideoRef} className="call-local-pip" autoPlay playsInline muted />
            )}
          </>
        ) : (
          <div className="call-voice-stage">
            <Avatar account={account} mxc={snap.peerAvatarMxc ?? undefined} name={name} id={snap.peerId ?? name} size={112} />
          </div>
        )}

        <div className="call-topbar">
          <div className="call-peer-name">{name}</div>
          <div className="call-status">{statusLine}</div>
          <CallEncryption encrypted={snap.encrypted} />
        </div>

        <audio ref={remoteAudioRef} autoPlay />

        {status !== "ended" && (
          <div className="call-controls">
            <button
              className={`call-control-btn${snap.micMuted ? " active" : ""}`}
              onClick={() => void calls.toggleMute()}
              aria-label={snap.micMuted ? "Unmute microphone" : "Mute microphone"}
              title={snap.micMuted ? "Unmute" : "Mute"}
            >
              {snap.micMuted ? <IconMicOff size={22} /> : <IconMic size={22} />}
            </button>
            {isVideo && (
              <button
                className={`call-control-btn${snap.videoMuted ? " active" : ""}`}
                onClick={() => void calls.toggleVideo()}
                aria-label={snap.videoMuted ? "Turn camera on" : "Turn camera off"}
                title={snap.videoMuted ? "Camera on" : "Camera off"}
              >
                {snap.videoMuted ? <IconVideoOff size={22} /> : <IconVideo size={22} />}
              </button>
            )}
            <button
              className="call-control-btn hangup"
              onClick={() => calls.hangup()}
              aria-label="Hang up"
              title="Hang up"
            >
              <IconPhoneOff size={22} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
