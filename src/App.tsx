// App shell: init, onboarding gate, three-pane layout, dialogs, notifications.

import { useEffect, useMemo, useState } from "react";
import { accountManager } from "./core/manager";
import type { SasFlow } from "./core/types";
import { useAccounts, useMediaQuery } from "./ui/hooks";
import { applyTheme } from "./ui/theme";
import { ToastProvider } from "./ui/components/Toast";
import { Onboarding } from "./ui/Onboarding";
import { AccountRail, RoomListPane, type Selection } from "./ui/RoomList";
import { ChatPane } from "./ui/ChatPane";
import { DetailsPane } from "./ui/DetailsPane";
import { NewChatDialog } from "./ui/dialogs/NewChatDialog";
import { SettingsDialog } from "./ui/dialogs/SettingsDialog";
import { VerificationDialog } from "./ui/dialogs/VerificationDialog";
import { wireNotifications } from "./ui/notifications";

applyTheme();

type Dialog = { kind: "none" } | { kind: "new-chat" } | { kind: "settings" } | { kind: "add-account" };

export function App() {
  const [phase, setPhase] = useState<"loading" | "onboarding" | "ready">("loading");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeFlow, setActiveFlow] = useState<SasFlow | null>(null);
  const narrow = useMediaQuery("(max-width: 760px)");
  useAccounts();

  useEffect(() => {
    accountManager
      .init()
      .then(() => setPhase(accountManager.hasAccounts() ? "ready" : "onboarding"))
      .catch(() => setPhase("onboarding"));
  }, []);

  // Notifications for every account; re-wire when the account set changes.
  const accountKeys = accountManager
    .list()
    .map((a) => a.key)
    .join(",");
  useEffect(() => {
    const unsubs = accountManager.list().map((a) => {
      const account = accountManager.account(a.key);
      if (!account.client) return () => undefined;
      return wireNotifications(account.client, (roomId) =>
        setSelection({ accountKey: a.key, roomId }),
      );
    });
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKeys, phase]);

  // Surface incoming verification requests from any account.
  useEffect(() => {
    if (phase !== "ready") return;
    const unsubs = accountManager.list().map((a) => {
      const account = accountManager.account(a.key);
      return account.crypto.events.on("flows", () => {
        const flow = account.crypto
          .activeFlows()
          .find((f) => !f.initiatedByMe && (f.phase === "requested" || f.phase === "ready" || f.phase === "emojis"));
        if (flow) setActiveFlow((cur) => cur ?? flow);
      });
    });
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKeys, phase]);

  // Refresh verification dialog phase changes.
  const flowAccount = useMemo(
    () => (activeFlow ? accountManager.tryAccount(activeFlow.accountKey) : null),
    [activeFlow],
  );
  const [, setFlowTick] = useState(0);
  useEffect(() => {
    if (!flowAccount) return;
    return flowAccount.crypto.events.on("flows", () => setFlowTick((n) => n + 1));
  }, [flowAccount]);

  if (phase === "loading") {
    return (
      <div className="app-loading">
        <span className="spinner" />
        <span>Opening Materix…</span>
      </div>
    );
  }

  if (phase === "onboarding") {
    return (
      <ToastProvider>
        <Onboarding onDone={() => setPhase("ready")} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className={`app${narrow && selection ? " mobile-chat" : ""}`}>
        <AccountRail
          onAddAccount={() => setDialog({ kind: "add-account" })}
          onSettings={() => setDialog({ kind: "settings" })}
        />
        <RoomListPane
          selection={selection}
          onSelect={(sel) => {
            setSelection(sel);
            setDetailsOpen(false);
          }}
          onNewChat={() => setDialog({ kind: "new-chat" })}
        />
        <ChatPane
          selection={selection}
          onBack={() => setSelection(null)}
          onToggleDetails={() => setDetailsOpen((v) => !v)}
          showBackButton={narrow}
        />
        {detailsOpen && selection && (
          <DetailsPane
            selection={selection}
            onClose={() => setDetailsOpen(false)}
            onLeft={() => {
              setDetailsOpen(false);
              setSelection(null);
            }}
          />
        )}
      </div>

      {dialog.kind === "new-chat" && (
        <NewChatDialog onClose={() => setDialog({ kind: "none" })} onOpenRoom={setSelection} />
      )}
      {dialog.kind === "settings" && (
        <SettingsDialog
          onClose={() => setDialog({ kind: "none" })}
          onAddAccount={() => setDialog({ kind: "add-account" })}
          onStartVerification={(flow) => setActiveFlow(flow)}
        />
      )}
      {dialog.kind === "add-account" && (
        <div className="modal-backdrop">
          <Onboarding
            onDone={() => setDialog({ kind: "none" })}
            onCancel={() => setDialog({ kind: "none" })}
          />
        </div>
      )}
      {activeFlow && <VerificationDialog flow={activeFlow} onClose={() => setActiveFlow(null)} />}
    </ToastProvider>
  );
}
