// Shared "user actions" context-menu builder: message, verify, copy ID, kick.

import type { MatrixAccount } from "../core/account";
import { uiBus } from "./bus";
import type { MenuItem } from "./components/ContextMenu";

export function buildUserMenu(
  account: MatrixAccount,
  userId: string,
  opts: {
    showError: (e: unknown) => void;
    show: (text: string) => void;
    /** The room the menu was opened from; verification reuses it when shared. */
    roomId?: string;
    canKick?: boolean;
    onKick?: () => void;
    /** Show "Ban from room" (caller supplies the room-scoped handler). */
    canBan?: boolean;
    onBan?: () => void;
  },
): MenuItem[] {
  const items: MenuItem[] = [];
  const me = account.info().userId;

  if (userId !== me) {
    items.push({
      label: "Send message",
      onClick: async () => {
        try {
          const roomId = await account.startDm(userId);
          uiBus.openRoom({ accountKey: account.key, roomId });
        } catch (e) {
          opts.showError(e);
        }
      },
    });
    items.push({
      label: "Verify user",
      onClick: async () => {
        try {
          // Verify in the room the menu was opened from when the target shares
          // it; only fall back to a DM (reused or new) otherwise. This avoids
          // spawning a fresh chat when verifying someone you're already with.
          const roomId =
            opts.roomId && account.isJoinedMember(opts.roomId, userId)
              ? opts.roomId
              : await account.startDm(userId);
          uiBus.openRoom({ accountKey: account.key, roomId });
          const flow = await account.crypto.startUserVerification(userId, roomId);
          uiBus.showFlow(flow);
        } catch (e) {
          opts.showError(e);
        }
      },
    });
  }
  items.push({
    label: "Copy user ID",
    onClick: () => {
      navigator.clipboard.writeText(userId).then(() => opts.show("User ID copied."));
    },
  });
  if (userId !== me) {
    const ignored = account.ignoredUsers().includes(userId);
    items.push({
      label: ignored ? "Unignore user" : "Ignore user",
      danger: !ignored,
      onClick: async () => {
        try {
          await account.setIgnored(userId, !ignored);
          opts.show(ignored ? "User unignored." : "User ignored.");
        } catch (e) {
          opts.showError(e);
        }
      },
    });
  }
  if (opts.canKick && userId !== me && opts.onKick) {
    items.push({ label: "Remove from room", danger: true, onClick: opts.onKick });
  }
  if (opts.canBan && userId !== me && opts.onBan) {
    items.push({ label: "Ban from room", danger: true, onClick: opts.onBan });
  }
  return items;
}
