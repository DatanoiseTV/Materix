// App-level audio engine. One detached HTMLAudioElement plays a single track at
// a time and lives outside the React tree, so a voice message or audio file
// keeps playing when the user switches rooms (which unmounts the timeline).
// The in-timeline players and the persistent now-playing bar are thin views
// over this shared state.

import { useSyncExternalStore } from "react";

export interface AudioTrack {
  /** Stable per-message id (TimelineItem.id) — identifies the track across remounts. */
  id: string;
  /** Resolved object URL for the media (may be regenerated on remount; that's fine). */
  src: string;
  name: string;
  voice?: boolean;
  durationMs?: number;
  waveform?: number[];
}

export interface AudioSnapshot {
  trackId: string | null;
  name: string;
  voice: boolean;
  waveform?: number[];
  playing: boolean;
  currentTime: number;
  duration: number;
}

let el: HTMLAudioElement | null = null;
let track: AudioTrack | null = null;
const listeners = new Set<() => void>();
let snap: AudioSnapshot = {
  trackId: null,
  name: "",
  voice: false,
  playing: false,
  currentTime: 0,
  duration: 0,
};

function element(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "metadata";
  const on = (name: string, fn: () => void) => el!.addEventListener(name, fn);
  on("timeupdate", emit);
  on("durationchange", emit);
  on("loadedmetadata", emit);
  on("play", emit);
  on("playing", emit);
  on("pause", emit);
  on("ended", () => {
    if (el) el.currentTime = 0;
    emit();
  });
  return el;
}

function emit(): void {
  const a = el;
  const dur =
    a && isFinite(a.duration) && a.duration > 0
      ? a.duration
      : track?.durationMs
        ? track.durationMs / 1000
        : 0;
  snap = {
    trackId: track?.id ?? null,
    name: track?.name ?? "",
    voice: !!track?.voice,
    waveform: track?.waveform,
    playing: !!a && !a.paused && !a.ended,
    currentTime: a?.currentTime ?? 0,
    duration: dur,
  };
  listeners.forEach((l) => l());
}

export const audioBus = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  snapshot(): AudioSnapshot {
    return snap;
  },
  /** Start or resume a track. Switching to a different track stops the previous one. */
  play(t: AudioTrack): void {
    const a = element();
    // Same track that still has a loaded source: resume in place (preserves
    // position when returning to a room). Otherwise (re)load the source.
    if (track?.id === t.id && a.currentSrc) {
      void a.play().catch(() => undefined);
    } else {
      track = t;
      a.src = t.src;
      a.currentTime = 0;
      void a.play().catch(() => undefined);
    }
    emit();
  },
  toggle(t: AudioTrack): void {
    const a = element();
    if (track?.id === t.id && a.currentSrc && !a.paused) {
      a.pause();
      emit();
    } else {
      this.play(t);
    }
  },
  pause(): void {
    el?.pause();
    emit();
  },
  seekFrac(frac: number): void {
    const a = el;
    if (!a || !isFinite(a.duration) || a.duration <= 0) return;
    a.currentTime = Math.max(0, Math.min(1, frac)) * a.duration;
    emit();
  },
  /** Fully stop and clear the current track (dismisses the now-playing bar). */
  stop(): void {
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    track = null;
    emit();
  },
  isActive(id: string): boolean {
    return track?.id === id;
  },
};

export function useAudioBus(): AudioSnapshot {
  return useSyncExternalStore(audioBus.subscribe, audioBus.snapshot, audioBus.snapshot);
}
