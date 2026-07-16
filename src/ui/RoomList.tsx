// Left column: account rail + unified room list across all accounts.

import { useEffect, useMemo, useState } from "react";
import { accountManager } from "../core/manager";
import type { RoomSummary } from "../core/types";
import { useAccounts, useClock, useRoomsVersion } from "./hooks";
import { Avatar } from "./components/Avatar";
import { ContextMenu, type MenuState } from "./components/ContextMenu";
import { IconChat, IconLock, IconPlus, IconSearch, IconSettings, IconShield } from "./components/Icons";
import { formatListTime, typingText } from "./format";
import { useToast } from "./components/Toast";

export interface Selection {
  accountKey: string;
  roomId: string;
}

export type NewChatTab = "dm" | "group" | "join";

export function AccountRail({
  onAddAccount,
  onSettings,
}: {
  onAddAccount: () => void;
  onSettings: () => void;
}) {
  useAccounts();
  useRoomsVersion();
  const accounts = accountManager.list();
  const active = accountManager.active;

  return (
    <nav className="rail" aria-label="Accounts">
      <div className="rail-accounts">
        {accounts.map((a) => {
          const unread = accountManager
            .account(a.key)
            .rooms()
            .reduce((n, r) => n + r.unreadCount + (r.isInvite ? 1 : 0), 0);
          return (
            <button
              key={a.key}
              className={`rail-btn${a.key === active ? " active" : ""}`}
              style={{ ["--account-color" as string]: a.color }}
              onClick={() => accountManager.setActive(a.key)}
              title={`${a.userId}${a.syncState === "error" ? " — connection trouble" : ""}`}
              aria-label={`Account ${a.userId}`}
              aria-current={a.key === active}
            >
              <Avatar account={accountManager.account(a.key)} mxc={a.avatarUrl} name={a.displayName} id={a.userId} size={38} />
              {unread > 0 && <span className="rail-badge">{unread > 99 ? "99+" : unread}</span>}
              {a.syncState === "error" && <span className="rail-sync-error" />}
            </button>
          );
        })}
        <button className="rail-btn" onClick={onAddAccount} title="Add account" aria-label="Add account">
          <IconPlus />
        </button>
      </div>
      <button className="rail-btn" onClick={onSettings} title="Settings" aria-label="Settings">
        <IconSettings />
      </button>
    </nav>
  );
}

export function RoomListPane({
  selection,
  onSelect,
  onNewChat,
  onOpenSecurity,
}: {
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
  onNewChat: (tab: NewChatTab) => void;
  onOpenSecurity: (accountKey: string) => void;
}) {
  useRoomsVersion();
  useAccounts();
  const now = useClock(30_000);
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const { showError, show } = useToast();

  const accounts = accountManager.list();
  const multiAccount = accounts.length > 1;

  const allRooms = useMemo(() => {
    const rooms: RoomSummary[] = [];
    for (const a of accounts) {
      try {
        rooms.push(...accountManager.account(a.key).rooms());
      } catch {
        // account may be mid-teardown
      }
    }
    return rooms;
  }, [accounts, accountManager.events.version("rooms")]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = filter.trim().toLowerCase();
  const visible = allRooms.filter((r) => !r.isSpace && (!q || r.name.toLowerCase().includes(q)));

  const invites = visible.filter((r) => r.isInvite);
  const chats = visible
    .filter((r) => !r.isInvite && !r.isLowPriority)
    .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.lastActivityTs - a.lastActivityTs);
  const lowPriority = visible
    .filter((r) => !r.isInvite && r.isLowPriority)
    .sort((a, b) => b.lastActivityTs - a.lastActivityTs);

  const colorOf = (key: string) => accounts.find((a) => a.key === key)?.color ?? "gray";

  return (
    <div className="rooms-pane">
      <div className="rooms-header">
        <h1>Chats</h1>
        <button
          className="icon-btn"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({
              x: r.left,
              y: r.bottom + 4,
              items: [
                { label: "New direct message", onClick: () => onNewChat("dm") },
                { label: "New group", onClick: () => onNewChat("group") },
                { label: "Join a room", onClick: () => onNewChat("join") },
              ],
            });
          }}
          title="New chat"
          aria-label="New chat"
          aria-haspopup="menu"
        >
          <IconPlus size={20} />
        </button>
      </div>
      <SecurityBanner onOpenSecurity={onOpenSecurity} />
      <div className="search-box">
        <IconSearch size={16} />
        <input
          type="search"
          placeholder="Search chats"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search chats"
        />
      </div>
      <div className="rooms-scroll">
        {invites.length > 0 && (
          <div className="rooms-section">
            <div className="rooms-section-title">Invitations</div>
            {invites.map((r) => (
              <div key={r.accountKey + r.roomId} className="invite-card">
                <div className="invite-card-head">
                  <Avatar account={accountManager.account(r.accountKey)} mxc={r.avatarUrl} name={r.name} id={r.roomId} size={36} />
                  <div className="room-item-main">
                    <span className="room-item-name">{r.name}</span>
                    <span className="room-item-preview">
                      {r.inviterName ? `Invited by ${r.inviterName}` : "You've been invited"}
                    </span>
                  </div>
                </div>
                <div className="invite-actions">
                  <button
                    className="btn primary small"
                    onClick={async () => {
                      try {
                        await accountManager.account(r.accountKey).acceptInvite(r.roomId);
                        onSelect({ accountKey: r.accountKey, roomId: r.roomId });
                      } catch (e) {
                        showError(e);
                      }
                    }}
                  >
                    Accept
                  </button>
                  <button
                    className="btn secondary small"
                    onClick={async () => {
                      try {
                        await accountManager.account(r.accountKey).rejectInvite(r.roomId);
                        show("Invitation declined.");
                      } catch (e) {
                        showError(e);
                      }
                    }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <RoomSection
          title={q ? `Results (${chats.length})` : undefined}
          rooms={chats}
          selection={selection}
          onSelect={onSelect}
          onMenu={setMenu}
          now={now}
          multiAccount={multiAccount}
          colorOf={colorOf}
        />
        {lowPriority.length > 0 && (
          <RoomSection
            title="Low priority"
            rooms={lowPriority}
            selection={selection}
            onSelect={onSelect}
            onMenu={setMenu}
            now={now}
            multiAccount={multiAccount}
            colorOf={colorOf}
          />
        )}

        {visible.length === 0 && (
          <div className="empty-state" style={{ padding: "var(--sp-5)" }}>
            <div className="empty-glyph">
              <IconChat size={30} />
            </div>
            {q ? (
              <p>No chats match "{filter}".</p>
            ) : (
              <>
                <h2 style={{ fontSize: "var(--fs-lg)" }}>No chats yet</h2>
                <p>Start a conversation or join a room to get going.</p>
                <button className="btn primary" onClick={() => onNewChat("dm")}>
                  Start a chat
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** First-run E2EE nudge for the active account: set up backup / verify session. */
function SecurityBanner({ onOpenSecurity }: { onOpenSecurity: (accountKey: string) => void }) {
  useAccounts();
  const activeKey = accountManager.active;
  const account = accountManager.tryAccount(activeKey);
  const [state, setState] = useState<"needs-setup" | "needs-verify" | "ok" | "unavailable" | "loading">("loading");
  const [dismissed, setDismissed] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem("materix.securityDismissed") ?? "[]"),
  );

  useEffect(() => {
    if (!account) return;
    let alive = true;
    const check = () => {
      account.crypto.securityState().then((s) => {
        if (alive) setState(s);
      });
    };
    check();
    const offStatus = account.crypto.events.on("status", check);
    // Sync state affects crypto readiness; re-check once shortly after mount.
    const t = setTimeout(check, 5000);
    return () => {
      alive = false;
      offStatus();
      clearTimeout(t);
    };
  }, [account]);

  if (!account || !activeKey) return null;
  if (state !== "needs-setup" && state !== "needs-verify") return null;
  if (dismissed.includes(activeKey)) return null;

  return (
    <div className="security-banner">
      <IconShield size={22} />
      <span className="banner-text">
        <strong>{state === "needs-setup" ? "Set up secure backup" : "Verify this session"}</strong>
        {state === "needs-setup"
          ? "Keep your encrypted messages safe on every device."
          : "Access your encrypted history on this device."}
      </span>
      <span className="banner-actions">
        <button className="btn primary small" onClick={() => onOpenSecurity(activeKey)}>
          {state === "needs-setup" ? "Set up" : "Verify"}
        </button>
        <button
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => {
            const next = [...dismissed, activeKey];
            setDismissed(next);
            localStorage.setItem("materix.securityDismissed", JSON.stringify(next));
          }}
        >
          ✕
        </button>
      </span>
    </div>
  );
}

function RoomSection({
  title,
  rooms,
  selection,
  onSelect,
  onMenu,
  now,
  multiAccount,
  colorOf,
}: {
  title?: string;
  rooms: RoomSummary[];
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
  onMenu: (menu: MenuState) => void;
  now: number;
  multiAccount: boolean;
  colorOf: (key: string) => string;
}) {
  const { show, showError } = useToast();
  if (rooms.length === 0) return null;

  const openMenu = (e: React.MouseEvent, r: RoomSummary) => {
    e.preventDefault();
    const account = accountManager.tryAccount(r.accountKey);
    if (!account) return;
    onMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Mark as read",
          onClick: () => account.room(r.roomId).markRead().catch(showError),
        },
        {
          label: r.isFavorite ? "Remove from favorites" : "Add to favorites",
          onClick: () => account.setRoomTag(r.roomId, "m.favourite", !r.isFavorite).catch(showError),
        },
        {
          label: r.isLowPriority ? "Restore priority" : "Mark low priority",
          onClick: () => account.setRoomTag(r.roomId, "m.lowpriority", !r.isLowPriority).catch(showError),
        },
        {
          label: "Copy room address",
          onClick: () => navigator.clipboard.writeText(r.roomId).then(() => show("Copied.")),
        },
        {
          label: "Leave",
          danger: true,
          onClick: () => {
            if (confirm(`Leave "${r.name}"?`)) account.room(r.roomId).leave().catch(showError);
          },
        },
      ],
    });
  };
  return (
    <div className="rooms-section">
      {title && <div className="rooms-section-title">{title}</div>}
      {rooms.map((r) => {
        const selected = selection?.accountKey === r.accountKey && selection?.roomId === r.roomId;
        const typing = typingText(r.typing);
        return (
          <button
            key={r.accountKey + r.roomId}
            className={`room-item${selected ? " selected" : ""}${r.unreadCount > 0 ? " unread" : ""}`}
            onClick={() => onSelect({ accountKey: r.accountKey, roomId: r.roomId })}
            onContextMenu={(e) => openMenu(e, r)}
            aria-current={selected}
          >
            <Avatar
              account={accountManager.tryAccount(r.accountKey)}
              mxc={r.avatarUrl}
              name={r.name}
              id={r.roomId}
              size={44}
            />
            <div className="room-item-main">
              <div className="room-item-top">
                {multiAccount && (
                  <span className="account-dot" style={{ background: colorOf(r.accountKey) }} title="Account" />
                )}
                <span className="room-item-name">{r.name}</span>
                {r.isEncrypted && (
                  <span className="enc-lock" title="End-to-end encrypted">
                    <IconLock size={12} />
                  </span>
                )}
                {r.lastEvent && <span className="room-item-time">{formatListTime(r.lastEvent.ts, now)}</span>}
              </div>
              <div className="room-item-bottom">
                <span className={`room-item-preview${typing ? " typing" : ""}`}>
                  {typing ||
                    (r.lastEvent ? `${r.isDirect ? "" : r.lastEvent.senderName + ": "}${r.lastEvent.preview}` : "No messages yet")}
                </span>
                {r.unreadCount > 0 && (
                  <span className={`unread-pill${r.highlightCount > 0 ? " highlight" : ""}`}>
                    {r.unreadCount > 99 ? "99+" : r.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
