// Synthesized notification sounds — no audio files, all generated with the
// Web Audio API so they ship zero assets and stay crisp at any volume.

export type SoundId =
  | "none"
  | "ping"
  | "chime"
  | "pop"
  | "knock"
  | "marimba"
  | "glass"
  | "tritone"
  | "bell"
  | "droplet"
  | "pluck"
  | "harp"
  | "blip";

export const SOUND_OPTIONS: { id: SoundId; label: string }[] = [
  { id: "ping", label: "Ping" },
  { id: "chime", label: "Chime" },
  { id: "tritone", label: "Tri-tone" },
  { id: "bell", label: "Bell" },
  { id: "pop", label: "Pop" },
  { id: "droplet", label: "Droplet" },
  { id: "knock", label: "Knock" },
  { id: "pluck", label: "Pluck" },
  { id: "marimba", label: "Marimba" },
  { id: "harp", label: "Harp" },
  { id: "glass", label: "Glass" },
  { id: "blip", label: "Blip" },
  { id: "none", label: "Silent" },
];

let ctx: AudioContext | null = null;
function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** One shaped oscillator tone. */
function tone(
  ac: AudioContext,
  at: number,
  opts: { freq: number; dur: number; type?: OscillatorType; gain?: number; glideTo?: number },
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, at);
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, at + opts.dur);
  const peak = opts.gain ?? 0.18;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + opts.dur + 0.02);
}

/** Short filtered-noise burst (for knock/pop transients). */
function noise(ac: AudioContext, at: number, dur: number, freq: number, gain = 0.25): void {
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = 1.5;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(at);
}

const RECIPES: Record<Exclude<SoundId, "none">, (ac: AudioContext, t: number) => void> = {
  ping: (ac, t) => tone(ac, t, { freq: 880, dur: 0.32, type: "sine", gain: 0.2 }),
  chime: (ac, t) => {
    tone(ac, t, { freq: 784, dur: 0.5, gain: 0.16 });
    tone(ac, t + 0.11, { freq: 1047, dur: 0.55, gain: 0.14 });
    tone(ac, t + 0.22, { freq: 1319, dur: 0.6, gain: 0.12 });
  },
  pop: (ac, t) => {
    tone(ac, t, { freq: 420, dur: 0.16, type: "sine", gain: 0.28, glideTo: 900 });
    noise(ac, t, 0.05, 1200, 0.08);
  },
  knock: (ac, t) => {
    noise(ac, t, 0.08, 220, 0.35);
    noise(ac, t + 0.14, 0.08, 200, 0.32);
  },
  marimba: (ac, t) => {
    tone(ac, t, { freq: 659, dur: 0.28, type: "triangle", gain: 0.22 });
    tone(ac, t + 0.13, { freq: 988, dur: 0.34, type: "triangle", gain: 0.18 });
  },
  glass: (ac, t) => {
    tone(ac, t, { freq: 1175, dur: 0.7, type: "sine", gain: 0.14 });
    tone(ac, t, { freq: 2349, dur: 0.5, type: "sine", gain: 0.05 });
  },
  // Classic two-note message tone: a bright note answered a fourth below.
  tritone: (ac, t) => {
    tone(ac, t, { freq: 1319, dur: 0.28, type: "sine", gain: 0.2 });
    tone(ac, t + 0.16, { freq: 988, dur: 0.34, type: "sine", gain: 0.2 });
  },
  // Struck bell: fundamental plus inharmonic partials with long decay.
  bell: (ac, t) => {
    tone(ac, t, { freq: 660, dur: 0.9, type: "sine", gain: 0.18 });
    tone(ac, t, { freq: 660 * 2.76, dur: 0.6, type: "sine", gain: 0.06 });
    tone(ac, t, { freq: 660 * 5.4, dur: 0.35, type: "sine", gain: 0.03 });
  },
  // Water drop: quick downward pitch glide with a short tail.
  droplet: (ac, t) => {
    tone(ac, t, { freq: 1400, dur: 0.18, type: "sine", gain: 0.24, glideTo: 620 });
    tone(ac, t + 0.02, { freq: 700, dur: 0.22, type: "sine", gain: 0.08 });
  },
  // Plucked string: bright triangle body with a filtered-noise attack.
  pluck: (ac, t) => {
    noise(ac, t, 0.03, 2600, 0.12);
    tone(ac, t, { freq: 587, dur: 0.3, type: "triangle", gain: 0.22 });
  },
  // Gentle four-note ascending arpeggio (C E G C).
  harp: (ac, t) => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone(ac, t + i * 0.07, { freq: f, dur: 0.4, type: "triangle", gain: 0.15 }));
  },
  // Terse digital double blip.
  blip: (ac, t) => {
    tone(ac, t, { freq: 1046, dur: 0.07, type: "square", gain: 0.12 });
    tone(ac, t + 0.1, { freq: 1568, dur: 0.09, type: "square", gain: 0.12 });
  },
};

/** Play a notification sound by id (no-op for "none" or on failure). */
export function playSound(id: SoundId): void {
  if (id === "none") return;
  try {
    const ac = audio();
    RECIPES[id]?.(ac, ac.currentTime + 0.01);
  } catch {
    // Web Audio may be unavailable or gesture-gated; fail silently.
  }
}

// ----- call ringtones -------------------------------------------------------

export type RingtoneKind = "voice" | "video";

/** One cycle of the incoming-voice ring: a warm two-pulse "ring… ring". */
function ringVoiceCycle(ac: AudioContext, t: number): void {
  for (const off of [0, 0.42]) {
    tone(ac, t + off, { freq: 480, dur: 0.32, type: "sine", gain: 0.17 });
    tone(ac, t + off, { freq: 620, dur: 0.32, type: "sine", gain: 0.1 });
  }
}

/** One cycle of the incoming-video ring: a brighter, more urgent rising
 * arpeggio with a shimmer on top, clearly distinct from the voice ring. */
function ringVideoCycle(ac: AudioContext, t: number): void {
  const notes = [659, 880, 1109, 1319];
  notes.forEach((f, i) => tone(ac, t + i * 0.13, { freq: f, dur: 0.28, type: "triangle", gain: 0.14 }));
  tone(ac, t + 0.55, { freq: 1760, dur: 0.45, type: "sine", gain: 0.05 });
}

/** One cycle of the outgoing ringback (shared by voice and video): a soft,
 * repeating low double-tone so the caller hears the line ringing. */
function ringbackCycle(ac: AudioContext, t: number): void {
  tone(ac, t, { freq: 440, dur: 0.9, type: "sine", gain: 0.08 });
  tone(ac, t, { freq: 480, dur: 0.9, type: "sine", gain: 0.06 });
}

function loopCycle(cycle: (ac: AudioContext, t: number) => void, periodMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const ac = audio();
    const play = () => {
      if (!stopped) cycle(ac, ac.currentTime + 0.02);
    };
    play();
    timer = setInterval(play, periodMs);
  } catch {
    // gesture-gated / unavailable: return a no-op stopper below
  }
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

/** Start looping the incoming-call ringtone for the given call kind. Returns a
 * stop function; call it on answer / decline / hangup. */
export function startRingtone(kind: RingtoneKind): () => void {
  return kind === "video" ? loopCycle(ringVideoCycle, 2600) : loopCycle(ringVoiceCycle, 3000);
}

/** Start the outgoing ringback tone (same for voice and video). */
export function startRingback(): () => void {
  return loopCycle(ringbackCycle, 3000);
}
