// New chat: DM via user search, create group, join public room — tabbed.

import { useEffect, useState } from "react";
import { accountManager } from "../../core/manager";
import type { UserSearchResult } from "../../core/types";
import { Modal } from "../components/Modal";
import { Avatar } from "../components/Avatar";
import { useDebounced } from "../hooks";
import { useToast } from "../components/Toast";
import type { Selection } from "../RoomList";

type Tab = "dm" | "group" | "join";

export function NewChatDialog({
  onClose,
  onOpenRoom,
  initialTab = "dm",
}: {
  onClose: () => void;
  onOpenRoom: (sel: Selection) => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const accounts = accountManager.list();
  const [accountKey, setAccountKey] = useState(accountManager.active ?? accounts[0]?.key ?? "");
  const account = accountManager.tryAccount(accountKey);
  const { showError } = useToast();
  const [busy, setBusy] = useState(false);

  // dm state
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // group state
  const [groupName, setGroupName] = useState("");
  const [groupInvites, setGroupInvites] = useState("");
  const [encrypted, setEncrypted] = useState(true);

  // join state
  const [joinInput, setJoinInput] = useState("");

  useEffect(() => {
    if (!account || debouncedQuery.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    account
      .searchUsers(debouncedQuery.trim())
      .then((r) => {
        if (alive) setResults(r.filter((u) => u.userId !== account.info().userId));
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [account, debouncedQuery]);

  async function startDm(userId: string) {
    if (!account) return;
    setBusy(true);
    try {
      const roomId = await account.startDm(userId);
      onOpenRoom({ accountKey, roomId });
      onClose();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    if (!account) return;
    setBusy(true);
    try {
      const invite = groupInvites
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^@[^:]+:.+/.test(s));
      const roomId = await account.createRoom({ name: groupName.trim(), invite, encrypted });
      onOpenRoom({ accountKey, roomId });
      onClose();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!account) return;
    setBusy(true);
    try {
      const roomId = await account.joinRoom(joinInput);
      onOpenRoom({ accountKey, roomId });
      onClose();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New chat" onClose={onClose}>
      {accounts.length > 1 && (
        <div className="field">
          <label>Account</label>
          <div className="server-suggestions">
            {accounts.map((a) => (
              <button
                key={a.key}
                className={`chip${a.key === accountKey ? " selected" : ""}`}
                onClick={() => setAccountKey(a.key)}
              >
                {a.userId}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="server-suggestions" role="tablist" aria-label="Chat type">
        {(
          [
            ["dm", "Direct message"],
            ["group", "Group"],
            ["join", "Join a room"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`chip${tab === t ? " selected" : ""}`}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "dm" && (
        <>
          <div className="field">
            <label htmlFor="dm-search">Who do you want to message?</label>
            <input
              id="dm-search"
              placeholder="Search people, or type @user:server.org"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            {searching && (
              <div className="state-line" style={{ display: "flex", gap: 8 }}>
                <span className="spinner" /> Searching…
              </div>
            )}
            {results.map((u) => (
              <button key={u.userId} className="member-row" disabled={busy} onClick={() => startDm(u.userId)}>
                <Avatar account={account} mxc={u.avatarUrl} name={u.displayName ?? u.userId} id={u.userId} size={36} />
                <span className="member-name">
                  <div>{u.displayName ?? u.userId}</div>
                  {u.displayName && <div className="field-hint">{u.userId}</div>}
                </span>
              </button>
            ))}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="field-hint">
                No one found. Type a full user ID like <code>@alice:matrix.org</code> to message them directly.
              </p>
            )}
          </div>
        </>
      )}

      {tab === "group" && (
        <>
          <div className="field">
            <label htmlFor="group-name">Group name</label>
            <input id="group-name" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Team chat" />
          </div>
          <div className="field">
            <label htmlFor="group-invites">Invite people (optional)</label>
            <input
              id="group-invites"
              value={groupInvites}
              onChange={(e) => setGroupInvites(e.target.value)}
              placeholder="@alice:matrix.org, @bob:matrix.org"
            />
          </div>
          <div className="switch-row">
            <div>
              <div className="switch-title">End-to-end encryption</div>
              <div className="switch-sub">Can't be turned off later</div>
            </div>
            <button
              className="switch"
              role="switch"
              aria-checked={encrypted}
              aria-label="End-to-end encryption"
              onClick={() => setEncrypted((v) => !v)}
            />
          </div>
          <button className="btn primary" disabled={busy || !groupName.trim()} onClick={createGroup}>
            {busy ? <span className="spinner" /> : "Create group"}
          </button>
        </>
      )}

      {tab === "join" && (
        <>
          <div className="field">
            <label htmlFor="join-input">Room address</label>
            <input
              id="join-input"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="#room:matrix.org"
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
            <div className="field-hint">A room alias (#room:server) or room ID (!abc:server).</div>
          </div>
          <button className="btn primary" disabled={busy || !joinInput.trim()} onClick={join}>
            {busy ? <span className="spinner" /> : "Join"}
          </button>
        </>
      )}
    </Modal>
  );
}
