// Media access. Matrix v1.11 authenticated media requires an Authorization
// header, which <img src> cannot send — so all media is fetched to a blob
// and handed to the UI as an object URL, cached per (account, mxc, size).
// Encrypted attachments are decrypted with matrix-encrypt-attachment.

import type { MatrixClient } from "matrix-js-sdk";
import { decryptAttachment } from "matrix-encrypt-attachment";
import type { EncryptedFileInfo } from "./types";

// Bounded LRU of resolved object URLs, keyed by (account, mxc, size). Decrypted
// blobs stay in memory for the life of their object URL, so an unbounded cache
// leaks; on eviction the URL is revoked to release the blob. Revoking a URL an
// <img>/<video> has already loaded is safe (the element keeps the decoded
// resource); a remount re-fetches through the normal path.
const MAX_ENTRIES = 200;
const cache = new Map<string, Promise<string>>();

// Access-order bump: re-inserting moves the key to the newest position so the
// first key is always the least-recently-used one to evict.
function cacheGet(key: string): Promise<string> | undefined {
  const p = cache.get(key);
  if (p) {
    cache.delete(key);
    cache.set(key, p);
  }
  return p;
}

function cacheSet(key: string, p: Promise<string>): void {
  cache.set(key, p);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const evicted = cache.get(oldest);
    cache.delete(oldest);
    evicted?.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
}

function cacheKey(userId: string, mxc: string, thumb?: { w: number; h: number }): string {
  return `${userId}|${mxc}|${thumb ? `${thumb.w}x${thumb.h}` : "full"}`;
}

async function fetchAuthed(client: MatrixClient, url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${client.getAccessToken()}` },
  });
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
  return res;
}

/**
 * Resolve an unencrypted mxc:// to a displayable object URL.
 * Thumbnails use the server-side scaler; full size downloads the original.
 */
export function mediaUrl(
  client: MatrixClient,
  mxc: string,
  thumb?: { w: number; h: number },
): Promise<string> {
  const key = cacheKey(client.getUserId()!, mxc, thumb);
  let p = cacheGet(key);
  if (!p) {
    p = (async () => {
      const http = thumb
        ? client.mxcUrlToHttp(mxc, thumb.w, thumb.h, "scale", false, true, true)
        : client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true);
      if (!http) throw new Error("bad mxc url");
      const res = await fetchAuthed(client, http);
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => cache.delete(key));
    cacheSet(key, p);
  }
  return p;
}

/** Resolve an encrypted attachment (EncryptedFile) to an object URL. */
export function encryptedMediaUrl(
  client: MatrixClient,
  file: EncryptedFileInfo,
  mime?: string,
): Promise<string> {
  const key = cacheKey(client.getUserId()!, file.url + "#enc");
  let p = cacheGet(key);
  if (!p) {
    p = (async () => {
      const http = client.mxcUrlToHttp(file.url, undefined, undefined, undefined, false, true, true);
      if (!http) throw new Error("bad mxc url");
      const res = await fetchAuthed(client, http);
      const decrypted = await decryptAttachment(await res.arrayBuffer(), file);
      return URL.createObjectURL(new Blob([decrypted], { type: mime ?? "application/octet-stream" }));
    })();
    p.catch(() => cache.delete(key));
    cacheSet(key, p);
  }
  return p;
}

/** Small avatar helper: crop-thumbnail an mxc, or undefined when absent. */
export function avatarUrl(client: MatrixClient, mxc: string | null | undefined, size = 96): Promise<string> | undefined {
  if (!mxc) return undefined;
  const key = cacheKey(client.getUserId()!, mxc, { w: size, h: size });
  let p = cacheGet(key);
  if (!p) {
    p = (async () => {
      const http = client.mxcUrlToHttp(mxc, size, size, "crop", false, true, true);
      if (!http) throw new Error("bad mxc url");
      const res = await fetchAuthed(client, http);
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => cache.delete(key));
    cacheSet(key, p);
  }
  return p;
}
