// SAS emoji verification dialog, driven by a SasFlow from the core.

import type { SasFlow } from "../../core/types";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

export function VerificationDialog({ flow, onClose }: { flow: SasFlow; onClose: () => void }) {
  const { showError } = useToast();
  const peerLabel = flow.peer.deviceId
    ? `${flow.peer.userId} (${flow.peer.deviceId})`
    : flow.peer.userId;

  return (
    <Modal title="Verify session" onClose={() => void flow.cancel().finally(onClose)}>
      {flow.phase === "requested" && !flow.initiatedByMe && (
        <>
          <p>
            <strong>{peerLabel}</strong> wants to verify with you. Verifying proves you're both talking to the
            right person and unlocks message history sharing.
          </p>
          <div className="modal-footer" style={{ padding: 0 }}>
            <button className="btn secondary" onClick={() => void flow.cancel().finally(onClose)}>
              Decline
            </button>
            <button className="btn primary" onClick={() => flow.accept().catch(showError)}>
              Start verification
            </button>
          </div>
        </>
      )}

      {(flow.phase === "ready" || (flow.phase === "requested" && flow.initiatedByMe)) && (
        <div className="empty-state" style={{ padding: "var(--sp-4)" }}>
          <span className="spinner" />
          <p>
            Waiting for <strong>{peerLabel}</strong> to accept…
          </p>
        </div>
      )}

      {flow.phase === "emojis" && flow.emojis && (
        <>
          <p>Compare these emojis with the other device. Confirm only if both show the same, in the same order.</p>
          <div className="sas-emojis" role="list">
            {flow.emojis.map((e, i) => (
              <div className="sas-emoji" role="listitem" key={i}>
                <span className="sas-emoji-symbol" aria-hidden="true">
                  {e.symbol}
                </span>
                <span className="sas-emoji-name">{e.name}</span>
              </div>
            ))}
          </div>
          <div className="modal-footer" style={{ padding: 0 }}>
            <button className="btn danger-ghost" onClick={() => void flow.cancel().finally(onClose)}>
              They don't match
            </button>
            <button className="btn primary" onClick={() => flow.confirmMatch().catch(showError)}>
              They match
            </button>
          </div>
        </>
      )}

      {flow.phase === "confirmed" && (
        <div className="empty-state" style={{ padding: "var(--sp-4)" }}>
          <span className="spinner" />
          <p>Waiting for the other side to confirm…</p>
        </div>
      )}

      {flow.phase === "done" && (
        <>
          <p>
            ✓ Verified. This session and <strong>{peerLabel}</strong> now trust each other.
          </p>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      )}

      {flow.phase === "cancelled" && (
        <>
          <p className="form-error">
            Verification was cancelled{flow.cancelReason ? ` (${flow.cancelReason})` : ""}. You can try again at any
            time.
          </p>
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </Modal>
  );
}
