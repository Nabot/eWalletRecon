import { FormEvent, useEffect, useId, useRef, useState } from "react";
import type { DepositEventDto, PstBetLookupDto } from "@ewallet/shared";
import { formatNad } from "../api/client";
import { formatSender } from "../lib/sender";
import { providerLabel } from "../lib/providers";

type Props = {
  deposit: DepositEventDto;
  onClose: () => void;
  onLookup: (mobile?: string) => Promise<PstBetLookupDto>;
  onConfirm: (params: {
    userId: number;
    userName: string;
    mobile: string;
    note: string;
  }) => Promise<void>;
  error?: string | null;
  busy?: boolean;
};

export default function PstBetCreditModal({
  deposit,
  onClose,
  onLookup,
  onConfirm,
  error,
  busy,
}: Props) {
  const [mobile, setMobile] = useState(deposit.senderMsisdn ?? "");
  const [note, setNote] = useState("");
  const [lookup, setLookup] = useState<PstBetLookupDto | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy && !lookingUp) onClose();
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
  }, [busy, lookingUp, onClose]);

  // Auto-lookup when deposit has a sender MSISDN
  useEffect(() => {
    if (!deposit.senderMsisdn) return;
    let cancelled = false;
    (async () => {
      setLookingUp(true);
      setLookupError(null);
      try {
        const result = await onLookup();
        if (!cancelled) setLookup(result);
      } catch (e) {
        if (!cancelled) setLookupError(e instanceof Error ? e.message : "Lookup failed");
      } finally {
        if (!cancelled) setLookingUp(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lookup once when modal opens
  }, [deposit.id]);

  async function handleLookup(e?: FormEvent) {
    e?.preventDefault();
    setLookingUp(true);
    setLookupError(null);
    setLookup(null);
    try {
      const result = await onLookup(mobile.trim() || undefined);
      setLookup(result);
      setMobile(result.mobile);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (!lookup) return;
    await onConfirm({
      userId: lookup.punter.punterId,
      userName: lookup.punter.userName,
      mobile: lookup.mobile,
      note: note.trim(),
    });
  }

  const displayError = error || lookupError;
  const punterName = lookup
    ? [lookup.punter.firstName, lookup.punter.lastName].filter(Boolean).join(" ") || "—"
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && !lookingUp) onClose();
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
          Credit via PstBet
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

        <form onSubmit={handleLookup} className="mt-4 space-y-3">
          <label className="block font-sans text-sm">
            <span className="text-sand-200/70">Betting account mobile</span>
            <div className="mt-1 flex gap-2">
              <input
                ref={inputRef}
                className="flex-1 rounded-md bg-ink-950 border border-ink-700 px-3 py-2 outline-none focus:border-veld-500 font-mono text-sm"
                value={mobile}
                onChange={(e) => {
                  setMobile(e.target.value);
                  setLookup(null);
                }}
                placeholder="0811600013"
                disabled={busy || lookingUp}
              />
              <button
                type="submit"
                disabled={busy || lookingUp || !mobile.trim()}
                className="shrink-0 rounded-md border border-ink-700 px-3 py-2 text-sm font-sans hover:bg-ink-800 disabled:opacity-50"
              >
                {lookingUp ? "Looking up…" : "Look up"}
              </button>
            </div>
          </label>
        </form>

        {lookingUp && !lookup && (
          <p className="mt-3 text-sm text-sand-200/70 font-sans">Checking PstBet account…</p>
        )}

        {lookup && (
          <div className="mt-4 rounded-md border border-ink-700 bg-ink-950 p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-sand-200/55 font-sans">
              Confirm account
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm font-sans">
              <div>
                <dt className="text-xs text-sand-200/55">Name</dt>
                <dd className="text-sand-50">{punterName}</dd>
              </div>
              <div>
                <dt className="text-xs text-sand-200/55">Username</dt>
                <dd className="font-mono text-sand-50">{lookup.punter.userName}</dd>
              </div>
              <div>
                <dt className="text-xs text-sand-200/55">Account ID</dt>
                <dd className="font-mono text-sand-50">{lookup.punter.punterId}</dd>
              </div>
              <div>
                <dt className="text-xs text-sand-200/55">Balance</dt>
                <dd className="font-mono text-sand-50">
                  {lookup.punter.balance != null ? formatNad(lookup.punter.balance) : "—"}
                </dd>
              </div>
            </dl>
            {!lookup.amountInRange && (
              <p className="text-clay-400 text-sm font-sans">
                Amount is outside PstBet limits (N${lookup.minAmount}–N${lookup.maxAmount}). Use
                manual mark credited instead.
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleConfirm} className="mt-4 space-y-3">
          <label className="block font-sans text-sm">
            <span className="text-sand-200/70">Note (optional)</span>
            <input
              className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-3 py-2 outline-none focus:border-veld-500"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ticket # or context"
              disabled={busy}
            />
          </label>
          {displayError && <p className="text-clay-400 text-sm font-sans">{displayError}</p>}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy || lookingUp}
              className="flex-1 rounded-md border border-ink-700 py-2 text-sm font-sans hover:bg-ink-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || lookingUp || !lookup || !lookup.amountInRange}
              className="flex-1 rounded-md bg-veld-600 hover:bg-veld-500 text-white disabled:opacity-50 py-2 text-sm font-sans font-semibold"
            >
              {busy ? "Crediting…" : "Confirm & credit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
