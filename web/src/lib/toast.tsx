import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "error" | "info";

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  push: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `t-${++toastSeq}`;
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md border px-4 py-3 text-sm font-sans shadow-fb-md ${
              t.tone === "success"
                ? "border-veld-400/30 bg-ink-900 text-veld-500"
                : t.tone === "error"
                  ? "border-clay-400/30 bg-ink-900 text-clay-500"
                  : "border-ink-700 bg-ink-900 text-sand-50"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
