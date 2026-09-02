// In-app confirm/prompt dialogs built on Modal.
//
// Replaces the native window.confirm/window.prompt, which are unreliable in the
// Tauri Android WebView: there they can silently return false/null without ever
// showing UI, so a destructive action becomes a no-op (or, for a guard, fires
// unguarded). These render a real, keyboard-accessible Modal instead and always
// resolve on an explicit user choice.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "./Modal";

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PromptOptions {
  title: string;
  label?: string;
  body?: ReactNode;
  initial?: string;
  placeholder?: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

const Ctx = createContext<{
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}>({
  confirm: () => Promise.resolve(false),
  prompt: () => Promise.resolve(null),
});

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ kind: "confirm", opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.initial ?? "");
        setPending({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  // Put focus where the user acts. This effect runs after Modal's own mount
  // effect (Modal is a child), so it wins the initial focus grab: the prompt
  // caret lands in the text field, a confirm lands on the confirm button.
  useEffect(() => {
    if (pending?.kind === "prompt") {
      const el = inputRef.current;
      el?.focus();
      el?.select();
    } else if (pending?.kind === "confirm") {
      confirmRef.current?.focus();
    }
  }, [pending]);

  const settle = (result: boolean | string | null) => {
    if (!pending) return;
    (pending.resolve as (r: boolean | string | null) => void)(result);
    setPending(null);
  };

  const cancel = () => settle(pending?.kind === "prompt" ? null : false);
  const accept = () => settle(pending?.kind === "prompt" ? value : true);

  return (
    <Ctx.Provider value={api}>
      {children}
      {pending && (
        <Modal
          title={pending.opts.title}
          onClose={cancel}
          footer={
            <>
              <button type="button" className="btn secondary" onClick={cancel}>
                {pending.opts.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                ref={confirmRef}
                className={`btn ${pending.opts.danger ? "danger" : "primary"}`}
                onClick={accept}
              >
                {pending.opts.confirmLabel ?? "OK"}
              </button>
            </>
          }
        >
          {pending.opts.body && <div className="confirm-body">{pending.opts.body}</div>}
          {pending.kind === "prompt" && (
            <label className="field">
              {pending.opts.label && <span>{pending.opts.label}</span>}
              <input
                ref={inputRef}
                value={value}
                placeholder={pending.opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    accept();
                  }
                }}
              />
            </label>
          )}
        </Modal>
      )}
    </Ctx.Provider>
  );
}

/** Promise-based replacement for window.confirm. Resolves true on confirm. */
export function useConfirm() {
  return useContext(Ctx).confirm;
}

/** Promise-based replacement for window.prompt. Resolves null on cancel. */
export function usePrompt() {
  return useContext(Ctx).prompt;
}
