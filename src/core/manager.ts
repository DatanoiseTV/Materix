// AccountManager: the app-wide singleton owning all MatrixAccount instances.
// Contract: docs/api-contract.md "Core boundary".

import { createClient } from "matrix-js-sdk";
import type { IAuthData, RegisterRequest, RegisterResponse } from "matrix-js-sdk";
import type { AccountInfo, AccountKey, SessionData } from "./types";
import { MatrixAccount } from "./account";
import { accountKeyFor, deleteSession, loadSessions, saveSession } from "./storage";
import { resolveHomeserver } from "./discovery";
import { MaterixError, toMaterixError } from "./errors";
import { Emitter } from "./emitter";

const ACTIVE_KEY = "materix.activeAccount";

export type LoginOpts = { user: string; password: string } | { ssoToken: string };
export type RegisterOpts = { username: string; password: string };

class AccountManagerImpl {
  readonly events = new Emitter<"accounts" | "rooms">();
  private accounts = new Map<AccountKey, MatrixAccount>();
  private activeKey: AccountKey | null = localStorage.getItem(ACTIVE_KEY);
  private initDone = false;

  async init(): Promise<void> {
    if (this.initDone) return;
    this.initDone = true;
    const sessions = await loadSessions();
    await Promise.all(
      [...sessions.entries()].map(async ([key, session]) => {
        const account = new MatrixAccount(key, session);
        this.accounts.set(key, account);
        this.wire(account);
        try {
          await account.start();
        } catch (e) {
          account.startError = toMaterixError(e).userMessage;
          account.syncState = "error";
          console.error(`failed to start account ${session.userId}`, e);
        }
      }),
    );
    if (!this.activeKey || !this.accounts.has(this.activeKey)) {
      this.activeKey = this.accounts.keys().next().value ?? null;
    }
    this.events.emit("accounts");
    this.events.emit("rooms");
  }

  private wire(account: MatrixAccount): void {
    account.events.on("rooms", () => this.events.emit("rooms"));
    account.events.on("self", () => this.events.emit("accounts"));
  }

  async login(server: string, opts: LoginOpts): Promise<AccountKey> {
    const resolved = await resolveHomeserver(server);
    const tempClient = createClient({ baseUrl: resolved.baseUrl });
    let res;
    try {
      res =
        "password" in opts
          ? await tempClient.login("m.login.password", {
              identifier: { type: "m.id.user", user: opts.user },
              password: opts.password,
              initial_device_display_name: deviceName(),
            })
          : await tempClient.login("m.login.token", {
              token: opts.ssoToken,
              initial_device_display_name: deviceName(),
            });
    } catch (e) {
      throw toMaterixError(e, "login");
    }
    const session: SessionData = {
      userId: res.user_id,
      deviceId: res.device_id,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      homeserverUrl: res.well_known?.["m.homeserver"]?.base_url?.replace(/\/+$/, "") ?? resolved.baseUrl,
    };
    return this.adoptSession(session);
  }

  /**
   * Register a new account on `server` and sign in with it.
   *
   * Drives the Matrix User-Interactive Auth (UIA) registration flow. Materix
   * only completes flows that consist solely of `m.login.dummy` (no human
   * verification): the initial call returns a 401 with the available flows and
   * a session id, and we resubmit with `m.login.dummy` to finish. Any flow that
   * needs a CAPTCHA, email/phone verification, a registration token, or terms
   * acceptance is surfaced as an UNSUPPORTED_SERVER error telling the user to
   * register in a browser and then sign in.
   */
  async register(server: string, opts: RegisterOpts): Promise<AccountKey> {
    const resolved = await resolveHomeserver(server);
    const tempClient = createClient({ baseUrl: resolved.baseUrl });

    // Best-effort nicer error before we attempt the flow. Servers that don't
    // support the availability endpoint reject here; ignore that and let the
    // register call be the source of truth.
    try {
      const available = await tempClient.isUsernameAvailable(opts.username);
      if (!available) {
        throw new MaterixError("UNKNOWN", "That username is already taken. Choose another.", false);
      }
    } catch (e) {
      if (e instanceof MaterixError) throw e;
      // Non-availability failure (endpoint missing, rate limit, etc.): proceed.
    }

    const base: RegisterRequest = {
      username: opts.username,
      password: opts.password,
      initial_device_display_name: deviceName(),
    };

    // Step 1: probe for the UIA flows. A compliant server replies 401 with the
    // flow list; a server with no required stages may answer 200 immediately.
    let flowData: IAuthData;
    try {
      const res = await tempClient.registerRequest(base);
      return this.completeRegistration(res, resolved.baseUrl);
    } catch (e) {
      const data = uiaData(e);
      if (!data) throw toMaterixError(e, "login");
      flowData = data;
    }

    // Step 2: only proceed if some flow's remaining stages are all supported.
    const completed = new Set(flowData.completed ?? []);
    const flows = flowData.flows ?? [];
    const dummyFlow = flows.find((f) => {
      const remaining = f.stages.filter((s) => !completed.has(s));
      return remaining.length > 0 && remaining.every((s) => s === "m.login.dummy");
    });
    if (!dummyFlow) {
      throw unsupportedStageError(flows.flatMap((f) => f.stages));
    }

    // Step 3: complete the dummy stage.
    let res: RegisterResponse;
    try {
      res = await tempClient.registerRequest({
        ...base,
        auth: { type: "m.login.dummy", session: flowData.session },
      });
    } catch (e) {
      const data = uiaData(e);
      // Another UIA challenge came back: we can't satisfy it.
      if (data) throw unsupportedStageError((data.flows ?? []).flatMap((f) => f.stages));
      throw toMaterixError(e, "login");
    }
    return this.completeRegistration(res, resolved.baseUrl);
  }

  /** Turn a successful /register response into a live, active account. */
  private async completeRegistration(res: RegisterResponse, baseUrl: string): Promise<AccountKey> {
    if (!res.user_id || !res.access_token || !res.device_id) {
      // inhibit_login was not set, so the server should have returned these.
      throw new MaterixError(
        "UNKNOWN",
        "Registration succeeded but the server did not return a session. Try signing in.",
        false,
      );
    }
    const session: SessionData = {
      userId: res.user_id,
      deviceId: res.device_id,
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      homeserverUrl: baseUrl,
    };
    return this.adoptSession(session);
  }

  /** Persist a session, spin up its account, make it active, and announce it. */
  private async adoptSession(session: SessionData): Promise<AccountKey> {
    const key = await accountKeyFor(session.userId, session.deviceId);
    if (this.accounts.has(key)) {
      return key; // already signed in with this exact session
    }
    await saveSession(key, session);
    const account = new MatrixAccount(key, session);
    this.accounts.set(key, account);
    this.wire(account);
    await account.start();
    this.setActive(key);
    this.events.emit("accounts");
    return key;
  }

  /** Build the SSO redirect URL for a server (flow continues via ssoToken login). */
  async ssoLoginUrl(server: string): Promise<string> {
    const resolved = await resolveHomeserver(server);
    // Server base URL survives the redirect round-trip in sessionStorage.
    sessionStorage.setItem("materix.ssoServer", resolved.baseUrl);
    const tempClient = createClient({ baseUrl: resolved.baseUrl });
    return tempClient.getSsoLoginUrl(window.location.origin + window.location.pathname, "sso");
  }

  /** Whether the server offers each login flow. */
  async loginFlows(server: string): Promise<{ password: boolean; sso: boolean }> {
    const resolved = await resolveHomeserver(server);
    const tempClient = createClient({ baseUrl: resolved.baseUrl });
    try {
      const flows = (await tempClient.loginFlows()).flows.map((f) => f.type);
      return { password: flows.includes("m.login.password"), sso: flows.includes("m.login.sso") };
    } catch (e) {
      throw toMaterixError(e);
    }
  }

  async logout(key: AccountKey): Promise<void> {
    const account = this.accounts.get(key);
    if (!account) return;
    this.accounts.delete(key);
    if (this.activeKey === key) {
      this.setActive(this.accounts.keys().next().value ?? null);
    }
    this.events.emit("accounts");
    this.events.emit("rooms");
    await deleteSession(key);
    await account.destroy();
  }

  list(): AccountInfo[] {
    return [...this.accounts.values()].map((a) => a.info());
  }

  get active(): AccountKey | null {
    return this.activeKey;
  }

  setActive(key: AccountKey | null): void {
    this.activeKey = key;
    if (key) localStorage.setItem(ACTIVE_KEY, key);
    else localStorage.removeItem(ACTIVE_KEY);
    this.events.emit("accounts");
  }

  account(key: AccountKey): MatrixAccount {
    const a = this.accounts.get(key);
    if (!a) throw new Error(`unknown account ${key}`);
    return a;
  }

  tryAccount(key: AccountKey | null): MatrixAccount | null {
    return key ? (this.accounts.get(key) ?? null) : null;
  }

  hasAccounts(): boolean {
    return this.accounts.size > 0;
  }
}

function deviceName(): string {
  const platform = "__TAURI_INTERNALS__" in window ? "Desktop" : "Web";
  return `Materix ${platform}`;
}

/** A 401 UIA challenge carries the flow list in its body; extract it if present. */
function uiaData(err: unknown): IAuthData | null {
  const e = err as { httpStatus?: number; data?: IAuthData } | null;
  if (e && e.httpStatus === 401 && e.data && Array.isArray(e.data.flows)) {
    return e.data;
  }
  return null;
}

/** Explain, per stage, why Materix can't complete a registration flow. */
function unsupportedStageError(stages: string[]): MaterixError {
  const browserHint = "Please create your account in a web browser, then sign in here.";
  if (stages.includes("m.login.recaptcha")) {
    return new MaterixError(
      "UNSUPPORTED_SERVER",
      `This server requires a CAPTCHA to register, which Materix can't show yet. ${browserHint}`,
      false,
    );
  }
  if (stages.includes("m.login.email.identity") || stages.includes("m.login.msisdn")) {
    return new MaterixError(
      "UNSUPPORTED_SERVER",
      `This server requires email or phone verification to register, which Materix doesn't support yet. ${browserHint}`,
      false,
    );
  }
  if (stages.includes("m.login.registration_token")) {
    return new MaterixError(
      "UNSUPPORTED_SERVER",
      `This server requires a registration token to sign up, which Materix can't provide. ${browserHint}`,
      false,
    );
  }
  if (stages.includes("m.login.terms")) {
    return new MaterixError(
      "UNSUPPORTED_SERVER",
      `This server requires accepting its terms of service to register. ${browserHint}`,
      false,
    );
  }
  return new MaterixError(
    "UNSUPPORTED_SERVER",
    `This server needs a registration step Materix can't complete yet. ${browserHint}`,
    false,
  );
}

export const accountManager = new AccountManagerImpl();
