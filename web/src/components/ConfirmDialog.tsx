import { FormEvent, useEffect, useId, useRef } from "react";

type Props = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export default function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  busy,
  onConfirm,
  onClose,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await onConfirm();
    } catch {
      /* parent shows error toast; keep dialog open */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-ink-700 bg-ink-900 p-5"
      >
        <h3 id={titleId} className="font-sans text-xl font-semibold tracking-tight text-sand-50">
          {title}
        </h3>
        <p className="mt-2 text-sm text-sand-200/70 font-sans whitespace-pre-wrap">{body}</p>
        <form onSubmit={handleSubmit} className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-md border border-ink-700 py-2 text-sm font-sans hover:bg-ink-800 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="submit"
            disabled={busy}
            className={`flex-1 rounded-md py-2 text-sm font-sans font-semibold disabled:opacity-50 ${
              danger
                ? "bg-clay-600 hover:bg-clay-500 text-sand-50"
                : "bg-veld-600 hover:bg-veld-500 text-white"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
