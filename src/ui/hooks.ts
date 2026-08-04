// React bindings to the core layer's emitters via useSyncExternalStore.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { accountManager } from "../core/manager";
import type { MatrixAccount } from "../core/account";
import type { CallSnapshot } from "../core/calls";

/** Re-render on account list / active account / sync-state changes. */
export function useAccounts() {
  return useSyncExternalStore(
    (cb) => accountManager.events.on("accounts", cb),
    () => accountManager.events.version("accounts"),
  );
}

/** Re-render on any room-list-affecting change across all accounts. */
export function useRoomsVersion() {
  return useSyncExternalStore(
    (cb) => accountManager.events.on("rooms", cb),
    () => accountManager.events.version("rooms"),
  );
}

/** Re-render on a single room's timeline changes. */
export function useRoomVersion(account: MatrixAccount | null, roomId: string | null) {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!account || !roomId) return () => undefined;
      return account.events.on(`room:${roomId}`, cb);
    },
    [account, roomId],
  );
  return useSyncExternalStore(subscribe, () =>
    account && roomId ? account.events.version(`room:${roomId}`) : 0,
  );
}

/**
 * The single active (non-idle) call across all accounts, or null. Calls can
 * ring on any signed-in account, so this subscribes to every account's call
 * manager and re-subscribes when the account set changes.
 */
export function useActiveCall(): { account: MatrixAccount; snap: CallSnapshot } | null {
  const [, force] = useState(0);
  const accountsVersion = useAccounts();
  useEffect(() => {
    const offs = accountManager.list().map((info) =>
      accountManager.account(info.key).calls.events.on("call", () => force((n) => n + 1)),
    );
    return () => offs.forEach((o) => o());
  }, [accountsVersion]);
  for (const info of accountManager.list()) {
    const account = accountManager.account(info.key);
    const snap = account.calls.snapshot();
    if (snap.status !== "idle") return { account, snap };
  }
  return null;
}

/** Resolve a promise-producing loader to state, cancelling on dep change. */
export function useAsync<T>(load: () => Promise<T> | undefined, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    setValue(undefined);
    const p = load();
    if (p) {
      p.then((v) => {
        if (alive) setValue(v);
      }).catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Debounced value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Track whether the given media query matches. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Interval-based re-render (for relative timestamps). */
export function useClock(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Stable callback identity wrapper. */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
