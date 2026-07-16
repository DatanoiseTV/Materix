// Tracks in-progress live-location shares (per account+room) so the chat can
// show a "You're sharing live location — Stop" banner and stop them.

type Key = string;
const shares = new Map<Key, { stop: () => Promise<void>; startedAt: number; durationMs: number }>();
const listeners = new Set<() => void>();

function key(accountKey: string, roomId: string): Key {
  return `${accountKey}|${roomId}`;
}

export const liveShare = {
  add(accountKey: string, roomId: string, stop: () => Promise<void>, durationMs: number): void {
    // Timestamps come from the caller (Date.now is unavailable in some
    // contexts but fine here in the browser UI).
    shares.set(key(accountKey, roomId), { stop, startedAt: Date.now(), durationMs });
    listeners.forEach((l) => l());
  },
  get(accountKey: string, roomId: string) {
    return shares.get(key(accountKey, roomId));
  },
  async stop(accountKey: string, roomId: string): Promise<void> {
    const entry = shares.get(key(accountKey, roomId));
    if (!entry) return;
    shares.delete(key(accountKey, roomId));
    listeners.forEach((l) => l());
    await entry.stop();
  },
  onChange(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
