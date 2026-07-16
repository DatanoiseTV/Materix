// Media access. Matrix v1.11 authenticated media requires an Authorization
// header, which <img src> cannot send — so all media is fetched to a blob
// and handed to the UI as an object URL, cached per (account, mxc, size).
// Encrypted attachments are decrypted with matrix-encrypt-attachment.

import type { MatrixClient } from "matrix-js-sdk";
import { decryptAttachment } from "matrix-encrypt-attachment";
import type { EncryptedFileInfo } from "./types";

const cache = new Map<string, Promise<string>>();

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
  let p = cache.get(key);
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
    cache.set(key, p);
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
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const http = client.mxcUrlToHttp(file.url, undefined, undefined, undefined, false, true, true);
      if (!http) throw new Error("bad mxc url");
      const res = await fetchAuthed(client, http);
      const decrypted = await decryptAttachment(await res.arrayBuffer(), file);
      return URL.createObjectURL(new Blob([decrypted], { type: mime ?? "application/octet-stream" }));
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Small avatar helper: crop-thumbnail an mxc, or undefined when absent. */
export function avatarUrl(client: MatrixClient, mxc: string | null | undefined, size = 96): Promise<string> | undefined {
  if (!mxc) return undefined;
  const key = cacheKey(client.getUserId()!, mxc, { w: size, h: size });
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const http = client.mxcUrlToHttp(mxc, size, size, "crop", false, true, true);
      if (!http) throw new Error("bad mxc url");
      const res = await fetchAuthed(client, http);
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
