// New chat: DM via user search, create group, join public room — tabbed.

import { useEffect, useState } from "react";
import { accountManager } from "../../core/manager";
import type { PublicRoomResult, UserSearchResult } from "../../core/types";
import { Modal } from "../components/Modal";
import { Avatar } from "../components/Avatar";
import { useDebounced } from "../hooks";
import { useToast } from "../components/Toast";
import { IconUsers } from "../components/Icons";
import type { Selection } from "../RoomList";

type Tab = "dm" | "group" | "join" | "explore";

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

  // explore state
  const [exploreServer, setExploreServer] = useState("");
  const [exploreQuery, setExploreQuery] = useState("");
  const debouncedExplore = useDebounced(exploreQuery, 400);
  const [publicRooms, setPublicRooms] = useState<PublicRoomResult[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [nextBatch, setNextBatch] = useState<string | undefined>();

  useEffect(() => {
    if (tab !== "explore" || !account) return;
    let alive = true;
    setExploreLoading(true);
    setExploreError(null);
    account
      .publicRooms({ query: debouncedExplore, server: exploreServer })
      .then((page) => {
        if (!alive) return;
        setPublicRooms(page.rooms);
        setNextBatch(page.nextBatch);
      })
      .catch((e) => alive && setExploreError(e?.userMessage ?? "Couldn't load the room directory."))
      .finally(() => alive && setExploreLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, account, debouncedExplore, exploreServer]);

  async function loadMorePublic() {
    if (!account || !nextBatch) return;
    setExploreLoading(true);
    try {
      const page = await account.publicRooms({ query: debouncedExplore, server: exploreServer, since: nextBatch });
      setPublicRooms((prev) => [...prev, ...page.rooms]);
      setNextBatch(page.nextBatch);
    } catch (e) {
      showError(e);
    } finally {
      setExploreLoading(false);
    }
  }

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
            ["explore", "Explore"],
            ["join", "By address"],
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

      {tab === "explore" && (
        <>
          <div className="field" style={{ flexDirection: "row", gap: "var(--sp-2)" }}>
            <input
              style={{ flex: 2, minWidth: 0 }}
              placeholder="Search public rooms"
              value={exploreQuery}
              onChange={(e) => setExploreQuery(e.target.value)}
              aria-label="Search public rooms"
            />
            <input
              style={{ flex: 1, minWidth: 0 }}
              placeholder="server (optional)"
              value={exploreServer}
              onChange={(e) => setExploreServer(e.target.value)}
              aria-label="Server to explore"
              spellCheck={false}
            />
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto", margin: "0 calc(-1 * var(--sp-1))" }}>
            {exploreError && <div className="form-error">{exploreError}</div>}
            {publicRooms.map((r) => (
              <div key={r.roomId} className="member-row" style={{ padding: "var(--sp-2)", gap: "var(--sp-3)" }}>
                <Avatar account={account} mxc={r.avatarMxc} name={r.name} id={r.roomId} size={40} />
                <span className="member-name" style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                  <span className="field-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <IconUsers size={12} /> {r.memberCount}
                    {r.topic ? ` · ${r.topic.slice(0, 60)}` : ""}
                  </span>
                </span>
                <button
                  className="btn primary small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const roomId = await account!.joinRoom(r.alias ?? r.roomId);
                      onOpenRoom({ accountKey, roomId });
                      onClose();
                    } catch (e) {
                      showError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {r.joinedAlready ? "Open" : "Join"}
                </button>
              </div>
            ))}
            {exploreLoading && (
              <div className="state-line" style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <span className="spinner" /> Loading…
              </div>
            )}
            {!exploreLoading && publicRooms.length === 0 && !exploreError && (
              <p className="field-hint">No public rooms found here.</p>
            )}
            {nextBatch && !exploreLoading && (
              <button className="btn secondary small" style={{ width: "100%" }} onClick={loadMorePublic}>
                Load more
              </button>
            )}
          </div>
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
