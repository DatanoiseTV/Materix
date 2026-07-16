import { useState } from "react";
import type { RoomHandle } from "../../core/roomHandle";
import { Modal } from "../components/Modal";
import { IconPlus, IconX } from "../components/Icons";
import { useToast } from "../components/Toast";

export function PollDialog({ handle, onClose }: { handle: RoomHandle; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showError } = useToast();

  const valid = question.trim() && options.filter((o) => o.trim()).length >= 2;

  return (
    <Modal title="Create poll" onClose={onClose}>
      <div className="field">
        <label htmlFor="poll-q">Question</label>
        <input id="poll-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we do?" />
      </div>
      <div className="field">
        <label>Options</label>
        {options.map((opt, i) => (
          <div key={i} style={{ display: "flex", gap: "var(--sp-2)" }}>
            <input
              style={{ flex: 1 }}
              value={opt}
              onChange={(e) => setOptions((o) => o.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={`Option ${i + 1}`}
            />
            {options.length > 2 && (
              <button
                className="icon-btn"
                aria-label="Remove option"
                onClick={() => setOptions((o) => o.filter((_, j) => j !== i))}
              >
                <IconX size={16} />
              </button>
            )}
          </div>
        ))}
        {options.length < 20 && (
          <button className="btn secondary small" onClick={() => setOptions((o) => [...o, ""])}>
            <IconPlus size={14} /> Add option
          </button>
        )}
      </div>
      <div className="switch-row">
        <div className="switch-title">Allow multiple answers</div>
        <button className="switch" role="switch" aria-checked={multiple} onClick={() => setMultiple((v) => !v)} />
      </div>
      <button
        className="btn primary"
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await handle.createPoll(question.trim(), options.map((o) => o.trim()).filter(Boolean), multiple);
            onClose();
          } catch (e) {
            showError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <span className="spinner" /> : "Create poll"}
      </button>
    </Modal>
  );
}
