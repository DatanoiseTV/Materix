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
}: {
  account: MatrixAccount | null;
  /** mxc:// URL or already-resolved blob/https URL. */
  mxc?: string;
  name: string;
  /** Stable id for the fallback color (defaults to name). */
  id?: string;
  size?: number;
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

  return (
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
}
