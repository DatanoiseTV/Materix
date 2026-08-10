// Runtime API polyfills for old Android System WebViews (e.g. LineageOS 18.1 /
// Android 11 ships Chromium ~83). esbuild's build target lowers *syntax* but
// never adds missing runtime APIs, so we shim the few the app + deps rely on.
// Imported for its side effects as the very first thing in main.tsx.
//
// Chromium version each API landed in:
//   Array/TypedArray.prototype.at  -> 92   (marked v16 lexer uses .at(-1) heavily)
//   Object.hasOwn                  -> 93   (p-retry)
//   crypto.randomUUID              -> 92   (matrix-js-sdk webrtc / OIDC)
//   structuredClone                -> 98

// Array.prototype.at / TypedArray.prototype.at
(() => {
  function at(this: { length: number; [i: number]: unknown }, n: number) {
    n = Math.trunc(n) || 0;
    if (n < 0) n += this.length;
    return n < 0 || n >= this.length ? undefined : this[n];
  }
  for (const C of [Array, typeof Uint8Array !== "undefined" ? Uint8Array : null, typeof Int8Array !== "undefined" ? Int8Array : null]) {
    if (C && !(C.prototype as { at?: unknown }).at) {
      Object.defineProperty(C.prototype, "at", { value: at, writable: true, configurable: true });
    }
  }
  // Cover the remaining TypedArray views via the shared prototype when present.
  const TA = Object.getPrototypeOf(Uint8Array?.prototype ?? {});
  if (TA && !TA.at) Object.defineProperty(TA, "at", { value: at, writable: true, configurable: true });
  if (typeof "".at !== "function") {
    Object.defineProperty(String.prototype, "at", {
      value(this: string, n: number) {
        n = Math.trunc(n) || 0;
        if (n < 0) n += this.length;
        return n < 0 || n >= this.length ? undefined : this[n];
      },
      writable: true,
      configurable: true,
    });
  }
})();

// Object.hasOwn
if (!(Object as { hasOwn?: unknown }).hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    value: (obj: object, prop: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, prop),
    writable: true,
    configurable: true,
  });
}

// crypto.randomUUID (v4)
if (typeof crypto !== "undefined" && !crypto.randomUUID) {
  Object.defineProperty(crypto, "randomUUID", {
    value: () => {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
      return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
    },
    writable: true,
    configurable: true,
  });
}

// AggregateError (Chromium 85) — referenced by the bundle (p-retry / Promise.any).
if (typeof (globalThis as { AggregateError?: unknown }).AggregateError !== "function") {
  class AggregateErrorPolyfill extends Error {
    errors: unknown[];
    constructor(errors: Iterable<unknown>, message?: string) {
      super(message);
      this.name = "AggregateError";
      this.errors = [...errors];
    }
  }
  (globalThis as { AggregateError?: unknown }).AggregateError = AggregateErrorPolyfill;
}

// Promise.any (Chromium 85)
if (typeof (Promise as { any?: unknown }).any !== "function") {
  (Promise as { any?: unknown }).any = function any(iterable: Iterable<unknown>) {
    return new Promise((resolve, reject) => {
      const items = [...iterable];
      const errors: unknown[] = [];
      let pending = items.length;
      if (pending === 0) {
        reject(new (globalThis as { AggregateError: new (e: unknown[], m: string) => Error }).AggregateError([], "All promises were rejected"));
        return;
      }
      items.forEach((p, i) => {
        Promise.resolve(p).then(resolve, (e) => {
          errors[i] = e;
          if (--pending === 0) {
            reject(new (globalThis as { AggregateError: new (e: unknown[], m: string) => Error }).AggregateError(errors, "All promises were rejected"));
          }
        });
      });
    });
  };
}

// WeakRef (Chromium 84) — non-GC shim: holds a strong ref (never collected).
// Only used on WebViews too old to have it natively; on those the crypto WASM
// won't load anyway, so the (leaky) semantics don't affect the working path.
if (typeof (globalThis as { WeakRef?: unknown }).WeakRef !== "function") {
  class WeakRefPolyfill<T> {
    private _v: T;
    constructor(v: T) { this._v = v; }
    deref(): T { return this._v; }
  }
  (globalThis as { WeakRef?: unknown }).WeakRef = WeakRefPolyfill;
}

// FinalizationRegistry (Chromium 84) — no-op shim: never fires cleanup.
if (typeof (globalThis as { FinalizationRegistry?: unknown }).FinalizationRegistry !== "function") {
  class FinalizationRegistryPolyfill {
    register(): void {}
    unregister(): void {}
  }
  (globalThis as { FinalizationRegistry?: unknown }).FinalizationRegistry = FinalizationRegistryPolyfill;
}

// Promise.withResolvers (Chromium 119) — used throughout matrix-js-sdk's sync
// loop; without it "Sync startup aborted" and nothing (incl. verification) works.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== "function") {
  (Promise as { withResolvers?: unknown }).withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// structuredClone (best-effort; JSON round-trip is enough for the plain data
// the app clones — it does not clone Blobs/Maps through this path).
if (typeof (globalThis as { structuredClone?: unknown }).structuredClone !== "function") {
  (globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
