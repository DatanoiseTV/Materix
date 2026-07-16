// Minimal typed pub/sub used by the core layer to push coarse-grained
// invalidations to the UI (which re-reads snapshots via useSyncExternalStore).

export class Emitter<E extends string> {
  private listeners = new Map<E, Set<() => void>>();
  private versions = new Map<E, number>();

  on(event: E, cb: () => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  emit(event: E): void {
    this.versions.set(event, (this.versions.get(event) ?? 0) + 1);
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error("listener failed", e);
      }
    });
  }

  /** Monotonic per-event version, usable as a useSyncExternalStore snapshot. */
  version(event: E): number {
    return this.versions.get(event) ?? 0;
  }
}
