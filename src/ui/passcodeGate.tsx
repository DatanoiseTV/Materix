// Launch-time unlock prompt for passcode-protected accounts. The core crypto
// key module calls the registered prompt during account init (before the main
// UI mounts), so this registers at module load and drives a small modal via an
// external store. Multiple accounts can unlock in sequence, so requests queue.

import { useState, useSyncExternalStore } from "react";
import { registerPasscodePrompt } from "../core/cryptoStoreKey";
import { Modal } from "./components/Modal";

interface Pending {
  accountKey: string;
  retry: boolean;
  resolve: (value: string | null) => void;
}

let queue: Pending[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

registerPasscodePrompt(
  ({ accountKey, retry }) =>
    new Promise<string | null>((resolve) => {
      queue = [...queue, { accountKey, retry, resolve }];
      emit();
    }),
);

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const snapshot = (): Pending | null => queue[0] ?? null;

export function PasscodeGate() {
  const pending = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [value, setValue] = useState("");

  if (!pending) return null;

  const finish = (result: string | null) => {
    const { resolve } = pending;
    queue = queue.slice(1);
    setValue("");
    emit();
    resolve(result);
  };

  return (
    <Modal title="Unlock Materix" onClose={() => finish(null)}>
      <form
        className="passcode-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) finish(value);
        }}
      >
        <p className="field-hint">Enter your app passcode to unlock encrypted data on this device.</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Passcode"
          aria-label="Passcode"
          aria-invalid={pending.retry}
        />
        {pending.retry && <div className="form-error">Incorrect passcode — try again.</div>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value}>
            Unlock
          </button>
        </div>
      </form>
    </Modal>
  );
}
