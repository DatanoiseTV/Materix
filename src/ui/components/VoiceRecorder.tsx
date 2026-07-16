// Voice message recorder: captures mic audio via MediaRecorder, samples a
// waveform from the live signal, and hands back an ogg/opus (or webm) file.

import { useEffect, useRef, useState } from "react";
import { IconSend, IconTrash } from "./Icons";

export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (file: File, durationMs: number, waveform: number[]) => void;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const waveformRef = useRef<number[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startRef = useRef(0);
  const stateRef = useRef<"recording" | "cancelled" | "sending">("recording");
  // Callbacks change identity on every parent (Composer) re-render; keep them
  // in refs so the setup effect runs ONCE and the recorder isn't torn down and
  // restarted on each sync event (which corrupts audio and resets the timer).
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    let raf = 0;
    let audioCtx: AudioContext | null = null;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "";
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorderRef.current = rec;
        rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
        rec.onstop = () => {
          streamRef.current?.getTracks().forEach((t) => t.stop());
          audioCtx?.close();
          if (stateRef.current !== "sending") return;
          const type = rec.mimeType || "audio/ogg";
          const blob = new Blob(chunksRef.current, { type });
          const ext = type.includes("webm") ? "webm" : "ogg";
          const file = new File([blob], `voice-message.${ext}`, { type });
          // MSC3245 waveform is 0..1024, ~30-60 samples.
          const wf = waveformRef.current;
          const target = 50;
          const step = Math.max(1, Math.floor(wf.length / target));
          const down = Array.from({ length: Math.min(target, wf.length) }, (_, i) =>
            Math.round(Math.min(1, wf[i * step] ?? 0) * 1024),
          );
          onSendRef.current(file, Date.now() - startRef.current, down.length ? down : [512]);
        };

        // Waveform sampling from live analyser.
        audioCtx = new AudioContext();
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let lastSample = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setLevel(peak);
          const now = performance.now();
          if (now - lastSample > 100) {
            waveformRef.current.push(peak);
            lastSample = now;
          }
          raf = requestAnimationFrame(tick);
        };
        tick();

        rec.start();
        startRef.current = Date.now();
      } catch {
        setError("Microphone access was denied.");
      }
    })();

    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // Run once; callbacks are read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = (mode: "sending" | "cancelled") => {
    stateRef.current = mode;
    if (mode === "cancelled") onCancelRef.current();
    recorderRef.current?.stop();
  };

  if (error) {
    return (
      <div className="composer-main" style={{ padding: "var(--sp-3)" }}>
        <span className="form-error" style={{ flex: 1 }}>
          {error}
        </span>
        <button className="btn secondary small" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  const mm = Math.floor(elapsed / 60);
  const ss = (elapsed % 60).toString().padStart(2, "0");

  return (
    <div className="composer-main voice-recorder">
      <button className="icon-btn danger" onClick={() => stop("cancelled")} aria-label="Cancel recording">
        <IconTrash size={19} />
      </button>
      <div className="voice-rec-meter">
        <span className="rec-dot" />
        <span className="rec-time">
          {mm}:{ss}
        </span>
        <span className="rec-level" style={{ transform: `scaleX(${0.15 + level * 0.85})` }} />
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>Recording…</span>
      </div>
      <button className="send-btn" onClick={() => stop("sending")} aria-label="Send voice message">
        <IconSend size={18} />
      </button>
    </div>
  );
}
