import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import type { EncryptedFileInfo } from "./types";

// Mock the attachment decryptor at the module boundary so no real crypto runs.
// It returns a deterministic buffer; the media code only wraps it in a Blob.
const decryptAttachment = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer);
vi.mock("matrix-encrypt-attachment", () => ({
  decryptAttachment: (...args: unknown[]) =>
    decryptAttachment(...(args as [])),
}));

// The module keeps a process-wide LRU cache, so each test re-imports it fresh
// (paired with vi.resetModules) to start from an empty cache.
type MediaModule = typeof import("./media");
async function loadMedia(): Promise<MediaModule> {
  return import("./media");
}

// Records every object URL handed out, in creation order, so a test can name
// the URL that belongs to the Nth cached entry.
let createdUrls: string[] = [];
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

// A fetch stand-in: 200 OK with a blob()/arrayBuffer() the code can consume.
function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["x"]),
    arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
  } as unknown as Response;
}

// Minimal MatrixClient stand-in exposing only what media.ts calls. mxcUrlToHttp
// echoes its arguments into a deterministic URL so assertions can inspect them.
function fakeClient(overrides: Partial<MatrixClient> = {}): MatrixClient {
  return {
    getAccessToken: () => "tok-abc",
    getUserId: () => "@me:example.org",
    mxcUrlToHttp: (
      mxc: string,
      w?: number | null,
      h?: number | null,
      method?: string | null,
      _allowDirect?: boolean,
      _allowRedirects?: boolean,
      useAuth?: boolean,
    ) =>
      `https://hs.example.org/_matrix/client/v1/media?mxc=${encodeURIComponent(mxc)}` +
      `&w=${w ?? ""}&h=${h ?? ""}&method=${method ?? ""}&auth=${useAuth ? "1" : "0"}`,
    ...overrides,
  } as unknown as MatrixClient;
}

beforeEach(() => {
  vi.resetModules();
  createdUrls = [];
  decryptAttachment.mockClear();

  createObjectURL = vi.fn(() => {
    const url = `blob:mock/${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  });
  revokeObjectURL = vi.fn();
  // URL is a global class; attach the two static blob helpers node lacks.
  vi.stubGlobal("URL", Object.assign(globalThis.URL, {
    createObjectURL,
    revokeObjectURL,
  }));

  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Flush pending microtasks/timers so eviction's async revoke callback runs.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("mediaUrl", () => {
  it("builds a full-size authed URL and returns the object URL", async () => {
    const { mediaUrl } = await loadMedia();
    const client = fakeClient();

    const url = await mediaUrl(client, "mxc://hs/full");

    expect(url).toBe("blob:mock/0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, init] = fetchMock.mock.calls[0];
    // Full size passes no width/height/method but keeps authentication on.
    expect(reqUrl).toContain("mxc=mxc%3A%2F%2Fhs%2Ffull");
    expect(reqUrl).toContain("w=&h=&method=&auth=1");
    expect(init).toEqual({ headers: { Authorization: "Bearer tok-abc" } });
  });

  it("builds a thumbnail URL with scale params", async () => {
    const { mediaUrl } = await loadMedia();
    const client = fakeClient();

    await mediaUrl(client, "mxc://hs/pic", { w: 64, h: 48 });

    const [reqUrl] = fetchMock.mock.calls[0];
    expect(reqUrl).toContain("w=64&h=48&method=scale&auth=1");
  });

  it("caches by (user, mxc, size) so a repeat call does not refetch", async () => {
    const { mediaUrl } = await loadMedia();
    const client = fakeClient();

    const first = await mediaUrl(client, "mxc://hs/pic", { w: 64, h: 48 });
    const second = await mediaUrl(client, "mxc://hs/pic", { w: 64, h: 48 });

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("treats a different size as a distinct cache entry", async () => {
    const { mediaUrl } = await loadMedia();
    const client = fakeClient();

    await mediaUrl(client, "mxc://hs/pic", { w: 64, h: 48 });
    await mediaUrl(client, "mxc://hs/pic", { w: 32, h: 32 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a different account as a distinct cache entry", async () => {
    const { mediaUrl } = await loadMedia();

    await mediaUrl(fakeClient({ getUserId: () => "@a:hs" }), "mxc://hs/pic");
    await mediaUrl(fakeClient({ getUserId: () => "@b:hs" }), "mxc://hs/pic");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed fetch (retries on next call)", async () => {
    const { mediaUrl } = await loadMedia();
    const client = fakeClient();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);

    await expect(mediaUrl(client, "mxc://hs/gone")).rejects.toThrow(/404/);
    // A retry re-fetches because the rejected promise is evicted from cache.
    await mediaUrl(client, "mxc://hs/gone");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("encryptedMediaUrl", () => {
  const file: EncryptedFileInfo = {
    url: "mxc://hs/enc",
    key: { k: "k", alg: "A256CTR", ext: true, kty: "oct", key_ops: ["encrypt", "decrypt"] },
    iv: "iv",
    hashes: { sha256: "h" },
    v: "v2",
  };

  it("fetches, decrypts, and returns an object URL with the given mime", async () => {
    const { encryptedMediaUrl } = await loadMedia();
    const client = fakeClient();

    const url = await encryptedMediaUrl(client, file, "image/png");

    expect(url).toBe("blob:mock/0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decryptAttachment).toHaveBeenCalledTimes(1);
    // The mxc is resolved full-size (no scaler) through the authed path.
    const [reqUrl] = fetchMock.mock.calls[0];
    expect(reqUrl).toContain("mxc=mxc%3A%2F%2Fhs%2Fenc");
    expect(reqUrl).toContain("method=&auth=1");
  });

  it("caches encrypted results so a repeat call skips fetch and decrypt", async () => {
    const { encryptedMediaUrl } = await loadMedia();
    const client = fakeClient();

    const a = await encryptedMediaUrl(client, file);
    const b = await encryptedMediaUrl(client, file);

    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(decryptAttachment).toHaveBeenCalledTimes(1);
  });
});

describe("avatarUrl", () => {
  it("returns undefined for a null mxc", async () => {
    const { avatarUrl } = await loadMedia();
    expect(avatarUrl(fakeClient(), null)).toBeUndefined();
    expect(avatarUrl(fakeClient(), undefined)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("crop-thumbnails a square avatar at the requested size", async () => {
    const { avatarUrl } = await loadMedia();
    const client = fakeClient();

    const url = await avatarUrl(client, "mxc://hs/av", 96);

    expect(url).toBe("blob:mock/0");
    const [reqUrl] = fetchMock.mock.calls[0];
    expect(reqUrl).toContain("w=96&h=96&method=crop&auth=1");
  });
});

describe("bounded LRU eviction", () => {
  const CAP = 200;

  it("revokes the least-recently-used object URL once when the cache overflows", async () => {
    const { mediaUrl } = await loadMedia();
    const client = fakeClient();

    // Fill the cache to the cap; call order == key order == createObjectURL order.
    for (let i = 0; i < CAP; i++) {
      await mediaUrl(client, `mxc://hs/${i}`);
    }
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Overflow by one; the oldest key (0) is now least-recently-used.
    await mediaUrl(client, `mxc://hs/${CAP}`);
    await flush();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(createdUrls[0]);
  });

  it("bumps recency on access so a touched entry is not the next evicted", async () => {
    const { mediaUrl } = await loadMedia();
    const client = fakeClient();

    for (let i = 0; i < CAP; i++) {
      await mediaUrl(client, `mxc://hs/${i}`);
    }

    // Touch key 0: it moves to newest, so key 1 becomes least-recently-used.
    const touched = await mediaUrl(client, "mxc://hs/0");
    expect(fetchMock).toHaveBeenCalledTimes(CAP); // cache hit, no refetch
    expect(touched).toBe(createdUrls[0]);

    // Overflow: key 1's URL is revoked, key 0's is not.
    await mediaUrl(client, `mxc://hs/${CAP}`);
    await flush();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(createdUrls[1]);
    expect(revokeObjectURL).not.toHaveBeenCalledWith(createdUrls[0]);
  });
});
