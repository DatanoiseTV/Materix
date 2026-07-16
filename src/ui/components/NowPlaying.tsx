// Persistent now-playing bar. Rendered at app level (outside the panes) so it
// survives room switches and gives global control over the single track owned
// by audioBus — including while the originating message is off-screen.

import { IconPause, IconPlay, IconX } from "./Icons";
import { audioBus, useAudioBus } from "../audioBus";

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function NowPlaying() {
  const snap = useAudioBus();
  if (!snap.trackId) return null;

  const pct = snap.duration ? (snap.currentTime / snap.duration) * 100 : 0;
  const label = snap.voice ? "Voice message" : snap.name || "Audio";

  return (
    <div className="now-playing" role="region" aria-label="Now playing">
      <button
        className="np-play"
        onClick={() =>
          audioBus.toggle({ id: snap.trackId!, src: "", name: snap.name, voice: snap.voice, waveform: snap.waveform })
        }
        aria-label={snap.playing ? "Pause" : "Play"}
      >
        {snap.playing ? <IconPause size={16} /> : <IconPlay size={16} />}
      </button>

      <div className="np-body">
        <div className="np-name" title={label}>
          {label}
        </div>
        <div
          className="np-track"
          role="slider"
          aria-label="Seek"
          aria-valuenow={Math.round(pct)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            audioBus.seekFrac((e.clientX - rect.left) / rect.width);
          }}
        >
          <div className="np-bar">
            <div className="np-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="np-time">
        {fmt(snap.currentTime)}
        {snap.duration ? ` / ${fmt(snap.duration)}` : ""}
      </div>

      <button className="np-close" onClick={() => audioBus.stop()} aria-label="Stop">
        <IconX size={16} />
      </button>
    </div>
  );
}
