// Forward a message: pick a target room (any joined room across all accounts)
// and re-send a cleaned copy of the source event's content into it.

import { useMemo, useState } from "react";
import { accountManager } from "../../core/manager";
import type { RoomHandle } from "../../core/roomHandle";
import type { RoomSummary } from "../../core/types";
import { Modal } from "../components/Modal";
import { Avatar } from "../components/Avatar";
import { useToast } from "../components/Toast";
import { IconLock, IconSearch } from "../components/Icons";

export function ForwardDialog({
  source,
  eventId,
  onClose,
}: {
  source: RoomHandle;
  eventId: string;
  onClose: () => void;
}) {
  const { show, showError } = useToast();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ accountKey: string; roomId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const multiAccount = accountManager.list().length > 1;

  // All joined, non-space rooms across every account, newest-active first.
  const rooms = useMemo<RoomSummary[]>(() => {
    const all: RoomSummary[] = [];
    for (const info of accountManager.list()) {
      const account = accountManager.tryAccount(info.key);
      if (!account) continue;
      for (const r of account.rooms()) {
        if (r.isInvite || r.isSpace) continue;
        all.push(r);
      }
    }
    return all.sort((a, b) => b.lastActivityTs - a.lastActivityTs);
  }, []);

  const q = query.trim().toLowerCase();
  const visible = q ? rooms.filter((r) => r.name.toLowerCase().includes(q)) : rooms;

  async function forward() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const content = source.contentForForward(eventId);
      if (!content) {
        show("This message can't be forwarded.", "error");
        return;
      }
      await accountManager.account(selected.accountKey).forward(selected.roomId, content);
      show("Message forwarded.");
      onClose();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Forward message"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!selected || busy} onClick={forward}>
          {busy ? <span className="spinner" /> : "Forward"}
        </button>
      }
    >
      <div className="field forward-search">
        <IconSearch size={16} />
        <input
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label="Search chats"
        />
      </div>

      <div className="forward-list">
        {visible.map((r) => {
          const account = accountManager.tryAccount(r.accountKey);
          const isSelected = selected?.accountKey === r.accountKey && selected?.roomId === r.roomId;
          return (
            <button
              key={`${r.accountKey}:${r.roomId}`}
              className={`forward-row${isSelected ? " selected" : ""}`}
              aria-pressed={isSelected}
              onClick={() => setSelected({ accountKey: r.accountKey, roomId: r.roomId })}
            >
              <Avatar account={account} mxc={r.avatarUrl} name={r.name} id={r.roomId} size={36} />
              <span className="forward-row-text">
                <span className="forward-row-name">
                  {r.name}
                  {r.isEncrypted && <IconLock size={12} />}
                </span>
                {multiAccount && account && <span className="field-hint">{account.info().userId}</span>}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && <p className="field-hint">No chats found.</p>}
      </div>
    </Modal>
  );
}
