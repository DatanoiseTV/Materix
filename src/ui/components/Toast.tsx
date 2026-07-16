import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { MaterixError } from "../../core/errors";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const ToastCtx = createContext<{ show: (text: string, kind?: Toast["kind"]) => void }>({
  show: () => undefined,
});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const { show } = useContext(ToastCtx);
  return {
    show,
    showError: (e: unknown) => {
      show(e instanceof MaterixError ? e.userMessage : "Something went wrong.", "error");
      console.error(e);
    },
  };
}
