// Compact audio / voice-message player: play-pause, seekable waveform (or
// progress bar), time readout, download. Works for both m.audio files and
// MSC3245 voice messages.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconDownload } from "./Icons";

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  src,
  name,
  voice,
  durationMs,
  waveform,
}: {
  src?: string;
  name: string;
  voice?: boolean;
  durationMs?: number;
  waveform?: number[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationMs ? durationMs / 1000 : 0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
  }, [src]);

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

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  return (
    <div className={`audio-player${voice ? " voice" : ""}`}>
      <button className="audio-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={!src}>
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
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

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLAudioElement).duration;
          if (isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrent((e.target as HTMLAudioElement).currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />
    </div>
  );
}
