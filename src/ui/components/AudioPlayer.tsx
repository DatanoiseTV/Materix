// Compact audio / voice-message player: play-pause, seekable waveform (or
// progress bar), time readout, download. Works for both m.audio files and
// MSC3245 voice messages.
//
// Playback itself is owned by the app-level audioBus (a single detached
// <audio> element), so this component is only a *view*: it reflects and
// controls the shared engine, keyed by a stable trackId. That lets audio keep
// playing when the timeline unmounts (switching rooms).

import { useMemo } from "react";
import { IconDownload, IconPause, IconPlay } from "./Icons";
import { audioBus, useAudioBus, type AudioTrack } from "../audioBus";

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  trackId,
  src,
  name,
  voice,
  durationMs,
  waveform,
}: {
  trackId: string;
  src?: string;
  name: string;
  voice?: boolean;
  durationMs?: number;
  waveform?: number[];
}) {
  const snap = useAudioBus();
  const active = snap.trackId === trackId;
  const playing = active && snap.playing;
  const current = active ? snap.currentTime : 0;
  const duration = active && snap.duration ? snap.duration : durationMs ? durationMs / 1000 : 0;

  // Normalize the MSC3245 waveform (values 0..1024) to bar heights.
  const bars = useMemo(() => {
    if (!waveform?.length) return null;
    const target = 40;
    const step = waveform.length / target;
    return Array.from({ length: target }, (_, i) => {
      const v = waveform[Math.floor(i * step)] ?? 0;
      return Math.max(0.12, Math.min(1, v / 1024));
    });
  }, [waveform]);

  const pct = duration ? current / duration : 0;

  const track = (): AudioTrack => ({ id: trackId, src: src!, name, voice, durationMs, waveform });

  const toggle = () => {
    if (!src) return;
    audioBus.toggle(track());
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!src) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    if (active) audioBus.seekFrac(frac);
    else audioBus.play(track()); // start this track (from the beginning)
  };

  return (
    <div className={`audio-player${voice ? " voice" : ""}`}>
      <button className="audio-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={!src}>
        {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
      </button>

      <div className="audio-body">
        {!voice && <div className="audio-name">{name}</div>}
        <div className="audio-track" onClick={seek} role="slider" aria-label="Seek" aria-valuenow={Math.round(pct * 100)}>
          {bars ? (
            <div className="audio-wave">
              {bars.map((h, i) => (
                <span
                  key={i}
                  style={{
                    height: `${h * 100}%`,
                    background: i / bars.length <= pct ? "var(--accent)" : "var(--border-strong)",
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="audio-bar">
              <div className="audio-bar-fill" style={{ width: `${pct * 100}%` }} />
            </div>
          )}
        </div>
        <div className="audio-time">
          {fmt(current)} {duration ? `/ ${fmt(duration)}` : ""}
        </div>
      </div>

      {src && (
        <a className="icon-btn" href={src} download={name} aria-label="Download" style={{ width: 30, height: 30 }}>
          <IconDownload size={15} />
        </a>
      )}
    </div>
  );
}
