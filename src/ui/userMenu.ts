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
    canKick?: boolean;
    onKick?: () => void;
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
          const roomId = await account.startDm(userId);
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
  if (opts.canKick && userId !== me && opts.onKick) {
    items.push({ label: "Remove from room", danger: true, onClick: opts.onKick });
  }
  return items;
}
