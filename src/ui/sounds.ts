// Synthesized notification sounds — no audio files, all generated with the
// Web Audio API so they ship zero assets and stay crisp at any volume.

export type SoundId = "none" | "ping" | "chime" | "pop" | "knock" | "marimba" | "glass";

export const SOUND_OPTIONS: { id: SoundId; label: string }[] = [
  { id: "ping", label: "Ping" },
  { id: "chime", label: "Chime" },
  { id: "pop", label: "Pop" },
  { id: "knock", label: "Knock" },
  { id: "marimba", label: "Marimba" },
  { id: "glass", label: "Glass" },
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
