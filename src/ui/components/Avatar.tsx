import { useState, useEffect } from "react";
import type { MatrixAccount } from "../../core/account";
import { avatarUrl } from "../../core/media";
import { colorFor, initialsOf } from "../format";

export function Avatar({
  account,
  mxc,
  name,
  id,
  size = 40,
  presence,
}: {
  account: MatrixAccount | null;
  /** mxc:// URL or already-resolved blob/https URL. */
  mxc?: string;
  name: string;
  /** Stable id for the fallback color (defaults to name). */
  id?: string;
  size?: number;
  /** Optional presence dot (green online / amber unavailable; offline shows none). */
  presence?: "online" | "unavailable" | "offline";
}) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    if (!mxc) return;
    if (!mxc.startsWith("mxc://")) {
      setSrc(mxc);
      return;
    }
    if (!account?.client) return;
    avatarUrl(account.client, mxc, Math.min(256, size * 2))
      ?.then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account, mxc, size]);

  const avatar = (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        ["--fallback-color" as string]: colorFor(id ?? name),
      }}
    >
      {src ? <img src={src} alt="" /> : initialsOf(name)}
    </span>
  );

  // No dot for offline/unknown presence, so the plain avatar is returned as-is.
  // The dot lives in a wrapper (not inside `.avatar`, which clips via
  // overflow:hidden) so it can sit on the avatar's edge.
  if (!presence || presence === "offline") return avatar;
  return (
    <span className="avatar-presence" style={{ width: size, height: size }}>
      {avatar}
      <span className={`presence-dot presence-${presence}`} aria-hidden="true" />
    </span>
  );
}
