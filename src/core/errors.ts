// Single choke point mapping matrix-js-sdk / network errors to typed,
// user-presentable errors. UI never string-matches SDK errors.

export type MaterixErrorCode =
  | "BAD_CREDENTIALS"
  | "RATE_LIMITED"
  | "SERVER_UNREACHABLE"
  | "SESSION_EXPIRED"
  | "NO_PERMISSION"
  | "UNSUPPORTED_SERVER"
  | "DECRYPTION_FAILURE"
  | "NOT_FOUND"
  | "UNKNOWN";

export class MaterixError extends Error {
  constructor(
    public code: MaterixErrorCode,
    public userMessage: string,
    public retriable: boolean,
    cause?: unknown,
  ) {
    super(userMessage, { cause });
    this.name = "MaterixError";
  }
}

/** True for "offline / can't reach the server" failures. Used to keep automatic
 *  background work (e.g. history backfill) from toasting the user when offline —
 *  a failed automatic backfill is expected offline and not user-actionable. */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof MaterixError) return err.code === "SERVER_UNREACHABLE";
  const e = err as { name?: string; message?: string } | null;
  return e?.name === "TypeError" || e?.name === "ConnectionError" || !!e?.message?.includes("fetch");
}

interface MatrixHttpErrorLike {
  errcode?: string;
  httpStatus?: number;
  data?: { errcode?: string; error?: string; retry_after_ms?: number };
  message?: string;
  name?: string;
}

/**
 * Map any thrown value from the SDK/network layer to a MaterixError.
 * `context` selects the right message for ambiguous errcodes (M_FORBIDDEN
 * means "wrong password" on /login but "no permission" elsewhere).
 */
export function toMaterixError(err: unknown, context?: "login" | "join" | "send"): MaterixError {
  if (err instanceof MaterixError) return err;
  const e = (err ?? {}) as MatrixHttpErrorLike;
  const errcode = e.errcode ?? e.data?.errcode;

  if (errcode === "M_FORBIDDEN") {
    if (context === "login") {
      return new MaterixError("BAD_CREDENTIALS", "Incorrect username or password.", false, err);
    }
    if (context === "join") {
      return new MaterixError("NO_PERMISSION", "You are not allowed to join this room.", false, err);
    }
    return new MaterixError("NO_PERMISSION", "You do not have permission to do that.", false, err);
  }
  if (errcode === "M_LIMIT_EXCEEDED") {
    return new MaterixError("RATE_LIMITED", "The server is rate-limiting requests. Try again shortly.", true, err);
  }
  if (errcode === "M_UNKNOWN_TOKEN") {
    return new MaterixError("SESSION_EXPIRED", "This session has been signed out by the server.", false, err);
  }
  if (errcode === "M_NOT_FOUND") {
    return new MaterixError("NOT_FOUND", "Not found.", false, err);
  }
  if (errcode === "M_USER_DEACTIVATED") {
    return new MaterixError("BAD_CREDENTIALS", "This account has been deactivated.", false, err);
  }
  if (e.httpStatus === 401) {
    return context === "login"
      ? new MaterixError("BAD_CREDENTIALS", "Incorrect username or password.", false, err)
      : new MaterixError("SESSION_EXPIRED", "This session has been signed out by the server.", false, err);
  }
  // fetch() network failures surface as TypeError, the SDK's as ConnectionError.
  if (e.name === "TypeError" || e.name === "ConnectionError" || e.message?.includes("fetch")) {
    return new MaterixError("SERVER_UNREACHABLE", "Can't reach the server. Check your connection.", true, err);
  }
  return new MaterixError("UNKNOWN", e.data?.error ?? e.message ?? "Something went wrong.", true, err);
}

/** Retry-after hint for RATE_LIMITED errors, if the server provided one. */
export function retryAfterMs(err: unknown): number | undefined {
  return (err as MatrixHttpErrorLike)?.data?.retry_after_ms;
}
