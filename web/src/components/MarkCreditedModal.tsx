import { FormEvent, useEffect, useId, useRef, useState } from "react";
import type { DepositEventDto } from "@ewallet/shared";
import { formatNad } from "../api/client";
import { formatSender } from "../lib/sender";
import { providerLabel } from "../lib/providers";

type Props = {
  deposit: DepositEventDto;
  onClose: () => void;
  onSubmit: (betAccountId: string, note: string) => Promise<void>;
  error?: string | null;
  busy?: boolean;
};

export default function MarkCreditedModal({ deposit, onClose, onSubmit, error, busy }: Props) {
  const [betAccountId, setBetAccountId] = useState(deposit.creditBetAccountId ?? "");
  const [note, setNote] = useState(deposit.creditNote ?? "");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onClose();
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
  }, [busy, onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await onSubmit(betAccountId.trim(), note.trim());
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
        className="w-full max-w-lg rounded-lg border border-ink-700 bg-ink-900 p-5 max-h-[90vh] overflow-y-auto"
      >
        <h3 id={titleId} className="font-sans text-xl font-semibold tracking-tight text-sand-50">
          Mark as credited
        </h3>
        <p className="mt-1 font-mono text-lg text-sand-50">{formatNad(deposit.amount)}</p>
        <p className="mt-0.5 text-sm text-sand-200/70 font-sans">
          {providerLabel(deposit.provider)} · {formatSender(deposit)}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm font-sans">
          <div>
            <dt className="text-xs text-sand-200/55">To phone</dt>
            <dd className="text-sand-50">
              {deposit.walletNumber?.label ?? "—"}
              <div className="font-mono text-xs text-sand-200/60 mt-0.5">
                {deposit.walletNumber?.msisdn ?? "—"}
              </div>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-sand-200/55">Reference</dt>
            <dd className="font-mono text-sand-50">{deposit.reference ?? "—"}</dd>
          </div>
        </dl>

        <div className="mt-3">
          <p className="text-xs text-sand-200/55 font-sans mb-1">Raw SMS</p>
          <pre className="text-xs font-mono bg-ink-950 p-3 rounded border border-ink-700 text-sand-200/75 whitespace-pre-wrap break-words max-h-36 overflow-y-auto">
            {deposit.rawMessage}
          </pre>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block font-sans text-sm">
            <span className="text-sand-200/70">Bet account ID</span>
            <input
              ref={inputRef}
              className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-3 py-2 outline-none focus:border-veld-500"
              value={betAccountId}
              onChange={(e) => setBetAccountId(e.target.value)}
              placeholder="BET-1001"
              required
            />
          </label>
          <label className="block font-sans text-sm">
            <span className="text-sand-200/70">Note (optional)</span>
            <input
              className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-3 py-2 outline-none focus:border-veld-500"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Customer name or ticket #"
            />
          </label>
          {error && <p className="text-clay-400 text-sm font-sans">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-md border border-ink-700 py-2 text-sm font-sans hover:bg-ink-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !betAccountId.trim()}
              className="flex-1 rounded-md bg-veld-600 hover:bg-veld-500 text-white disabled:opacity-50 py-2 text-sm font-sans font-semibold"
            >
              {busy ? "Saving…" : "Mark credited"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
