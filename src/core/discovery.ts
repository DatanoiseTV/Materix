// Homeserver resolution: user input ("matrix.org", "https://host") ->
// validated base URL via .well-known discovery and /versions.

import { AutoDiscovery, AutoDiscoveryAction } from "matrix-js-sdk";
import { MaterixError } from "./errors";

export interface ResolvedServer {
  /** Base URL for API calls. */
  baseUrl: string;
  /** The server_name users see (domain part of user IDs). */
  serverName: string;
}

export async function resolveHomeserver(input: string): Promise<ResolvedServer> {
  let trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new MaterixError("SERVER_UNREACHABLE", "Enter a homeserver.", false);

  // Full URL given: trust it directly, validate below.
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    await validate(trimmed);
    return { baseUrl: trimmed, serverName: url.hostname };
  }

  // Bare domain: .well-known discovery first, direct https fallback.
  trimmed = trimmed.replace(/^@[^:]*:/, ""); // allow pasting a full user ID
  const config = await AutoDiscovery.findClientConfig(trimmed);
  const hs = config["m.homeserver"];
  if (hs.state === AutoDiscoveryAction.SUCCESS && hs.base_url) {
    return { baseUrl: hs.base_url.replace(/\/+$/, ""), serverName: trimmed };
  }
  const direct = `https://${trimmed}`;
  await validate(direct);
  return { baseUrl: direct, serverName: trimmed };
}

async function validate(baseUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/_matrix/client/versions`, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new MaterixError("SERVER_UNREACHABLE", `Can't reach ${baseUrl}.`, true, e);
  }
  if (!res.ok) {
    throw new MaterixError("SERVER_UNREACHABLE", `${baseUrl} does not look like a Matrix server.`, false);
  }
  const body = (await res.json()) as { versions?: string[] };
  if (!Array.isArray(body.versions) || body.versions.length === 0) {
    throw new MaterixError("UNSUPPORTED_SERVER", `${baseUrl} does not advertise Matrix API versions.`, false);
  }
}
