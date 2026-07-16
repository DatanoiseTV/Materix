// Local UI preferences (per device, not synced).

import type { SoundId } from "./sounds";

export type NotificationMode = "preview" | "name" | "off";

interface Prefs {
  notifications: NotificationMode;
  sound: SoundId;
}

const KEY = "materix.prefs";
const DEFAULTS: Prefs = { notifications: "preview", sound: "ping" };

let cached: Prefs | null = null;
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  if (!cached) {
    try {
      cached = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
    } catch {
      cached = { ...DEFAULTS };
    }
  }
  return cached;
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  cached = { ...getPrefs(), [key]: value };
  localStorage.setItem(KEY, JSON.stringify(cached));
  listeners.forEach((l) => l());
}

export function onPrefsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
