// AccountManager: the app-wide singleton owning all MatrixAccount instances.
// Contract: docs/api-contract.md "Core boundary".

import { createClient } from "matrix-js-sdk";
import type { AccountInfo, AccountKey, SessionData } from "./types";
import { MatrixAccount } from "./account";
import { accountKeyFor, deleteSession, loadSessions, saveSession } from "./storage";
import { resolveHomeserver } from "./discovery";
import { toMaterixError } from "./errors";
import { Emitter } from "./emitter";

const ACTIVE_KEY = "materix.activeAccount";

export type LoginOpts = { user: string; password: string } | { ssoToken: string };

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
    const key = await accountKeyFor(session.userId, session.deviceId);
    if (this.accounts.has(key)) {
      return key; // already logged in with this exact session
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

export const accountManager = new AccountManagerImpl();
