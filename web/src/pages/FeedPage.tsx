import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { DepositEventDto } from "@ewallet/shared";
import { api, formatNad, ageingClass, ageingLabel } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { AgeingChip, StatusBadge } from "../components/StatusBadge";
import MarkCreditedModal from "../components/MarkCreditedModal";
import ConfirmDialog from "../components/ConfirmDialog";
import { formatSender } from "../lib/sender";
import { providerLabel } from "../lib/providers";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

type ColId = "amount" | "status" | "received" | "provider" | "sender" | "reference" | "wallet" | "action";

const ALL_COLS: { id: ColId; label: string; locked?: boolean; defaultOn?: boolean }[] = [
  { id: "amount", label: "Amount", locked: true, defaultOn: true },
  { id: "status", label: "Status", locked: true, defaultOn: true },
  { id: "received", label: "Received", defaultOn: true },
  { id: "provider", label: "Provider", defaultOn: true },
  { id: "sender", label: "Sender", defaultOn: true },
  { id: "reference", label: "Reference", defaultOn: true },
  { id: "wallet", label: "Wallet", defaultOn: true },
  { id: "action", label: "Action", locked: true, defaultOn: true },
];

const COLS_STORAGE_KEY = "ewallet.feed.columns";

function loadColumns(): Record<ColId, boolean> {
  const base = Object.fromEntries(ALL_COLS.map((c) => [c.id, c.defaultOn !== false])) as Record<
    ColId,
    boolean
  >;
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<ColId, boolean>>;
    for (const c of ALL_COLS) {
      if (c.locked) base[c.id] = true;
      else if (typeof parsed[c.id] === "boolean") base[c.id] = parsed[c.id]!;
    }
  } catch {
    /* ignore */
  }
  return base;
}

function FeedSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-t border-ink-800">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-3 py-3">
              <div className="h-3 rounded bg-ink-800 animate-pulse" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function FeedPage() {
  const { token, staff } = useAuth();
  const qc = useQueryClient();
  const { push } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [walletNumberId, setWalletNumberId] = useState("");
  const [from, setFrom] = useState(todayInputValue());
  const [to, setTo] = useState(todayInputValue());
  const [q, setQ] = useState("");
  const qDebounced = useDebouncedValue(q, 300);
  const [creditTarget, setCreditTarget] = useState<DepositEventDto | null>(null);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<DepositEventDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [cols, setCols] = useState<Record<ColId, boolean>>(loadColumns);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    const s = searchParams.get("status");
    const w = searchParams.get("walletNumberId");
    const f = searchParams.get("from");
    const t = searchParams.get("to");
    const qq = searchParams.get("q");
    const p = searchParams.get("provider");
    if (s !== null) setStatus(s);
    if (w !== null) setWalletNumberId(w);
    if (f !== null) setFrom(f);
    if (t !== null) setTo(t);
    if (qq !== null) setQ(qq);
    if (p !== null) setProvider(p);
    setUrlReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from landing URL
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (provider) next.set("provider", provider);
    if (walletNumberId) next.set("walletNumberId", walletNumberId);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (qDebounced.trim()) next.set("q", qDebounced.trim());
    setSearchParams(next, { replace: true });
  }, [urlReady, status, provider, walletNumberId, from, to, qDebounced, setSearchParams]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!colMenuRef.current?.contains(e.target as Node)) setColMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function toggleCol(id: ColId) {
    const meta = ALL_COLS.find((c) => c.id === id);
    if (meta?.locked) return;
    setCols((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const visibleCols = ALL_COLS.filter((c) => cols[c.id]);
  const colCount = visibleCols.length;

  const filters = useMemo(
    () => ({
      status: status || undefined,
      provider: provider || undefined,
      walletNumberId: walletNumberId || undefined,
      from: from ? `${from}T00:00:00` : undefined,
      to: to ? `${to}T23:59:59.999` : undefined,
      q: qDebounced.trim() || undefined,
      limit: 200,
    }),
    [status, provider, walletNumberId, from, to, qDebounced]
  );

  const { data, isLoading, isFetching, error, isPlaceholderData } = useQuery({
    queryKey: ["deposits", filters],
    queryFn: () => api.deposits(token!, filters),
    enabled: !!token,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const pendingCount = useQuery({
    queryKey: ["pending-count"],
    queryFn: () => api.pendingCount(token!),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const wallets = useQuery({
    queryKey: ["wallets"],
    queryFn: () => api.wallets(token!),
    enabled: !!token,
  });

  const mark = useMutation({
    mutationFn: ({ id, betAccountId, note }: { id: string; betAccountId: string; note: string }) =>
      api.markCredited(token!, id, betAccountId, note || undefined),
    onSuccess: (_res, vars) => {
      const amount = creditTarget ? formatNad(creditTarget.amount) : "";
      setCreditTarget(null);
      setCreditError(null);
      push(`Credited ${amount} → ${vars.betAccountId}`, "success");
      void qc.invalidateQueries({ queryKey: ["deposits"] });
      void qc.invalidateQueries({ queryKey: ["exceptions"] });
      void qc.invalidateQueries({ queryKey: ["pending-count"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc.invalidateQueries({ queryKey: ["daily-closeout"] });
    },
    onError: (e: Error) => setCreditError(e.message),
  });

  const uncredit = useMutation({
    mutationFn: (id: string) => api.uncredit(token!, id, "Admin undo from live feed"),
    onSuccess: () => {
      const amount = undoTarget ? formatNad(undoTarget.amount) : "deposit";
      setUndoTarget(null);
      push(`Undid credit on ${amount}`, "info");
      void qc.invalidateQueries({ queryKey: ["deposits"] });
      void qc.invalidateQueries({ queryKey: ["exceptions"] });
      void qc.invalidateQueries({ queryKey: ["pending-count"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc.invalidateQueries({ queryKey: ["daily-closeout"] });
    },
    onError: (e: Error) => {
      push(e.message, "error");
    },
  });

  function onStatusChange(next: string) {
    setStatus(next);
    if (next === "PENDING") {
      setFrom("");
      setTo("");
    } else if (!from && !to) {
      setFrom(todayInputValue());
      setTo(todayInputValue());
    }
  }

  function clearDatesForPending() {
    setStatus("PENDING");
    setFrom("");
    setTo("");
  }

  async function downloadCsv() {
    setExporting(true);
    try {
      const url = api.exportCsvUrl({
        from: from ? `${from}T00:00:00` : undefined,
        to: to ? `${to}T23:59:59.999` : undefined,
        walletNumberId: walletNumberId || undefined,
      });
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ewallet-deposits-${from || "export"}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      push("CSV exported", "success");
    } catch (e) {
      push(e instanceof Error ? e.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  const pendingTotal = pendingCount.data?.count ?? 0;
  const pendingInView = (data ?? []).filter((d) => d.matchStatus !== "MATCHED").length;
  const datesConstrained = Boolean(from || to);
  const showPendingBanner =
    datesConstrained && pendingTotal > 0 && (status !== "PENDING" || pendingInView < pendingTotal);

  const showSkeleton = isLoading && !data;

  function renderCells(d: DepositEventDto) {
    const age = ageingLabel(d);
    const cells: Record<ColId, React.ReactNode> = {
      amount: (
        <td key="amount" className="px-3 py-3">
          <div className="font-mono text-base text-sand-50 tabular-nums">{formatNad(d.amount)}</div>
          {d.creditBetAccountId && (
            <div className="font-mono text-[11px] text-sand-200 mt-0.5">{d.creditBetAccountId}</div>
          )}
        </td>
      ),
      status: (
        <td key="status" className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={d.matchStatus} />
            {age && <AgeingChip age={age} />}
          </div>
        </td>
      ),
      received: (
        <td key="received" className="px-3 py-3 font-mono text-xs text-sand-200 whitespace-nowrap">
          {new Date(d.receivedAt).toLocaleString()}
        </td>
      ),
      provider: (
        <td key="provider" className="px-3 py-3 text-sand-200">
          {providerLabel(d.provider)}
        </td>
      ),
      sender: (
        <td
          key="sender"
          className={`px-3 py-3 text-xs ${
            d.senderMsisdn ? "font-mono text-sand-200" : "font-sans text-sand-200"
          }`}
        >
          {formatSender(d)}
        </td>
      ),
      reference: (
        <td key="reference" className="px-3 py-3 font-mono text-xs text-sand-200">
          {d.reference ?? "—"}
        </td>
      ),
      wallet: (
        <td key="wallet" className="px-3 py-3">
          <div className="text-xs text-sand-200">{d.walletNumber?.label ?? "—"}</div>
          <div className="font-mono text-[11px] text-sand-200">{d.walletNumber?.msisdn}</div>
        </td>
      ),
      action: (
        <td key="action" className="px-3 py-3">
          {d.matchStatus !== "MATCHED" ? (
            <button
              type="button"
              onClick={() => {
                setCreditError(null);
                setCreditTarget(d);
              }}
              className="rounded-md border border-veld-500 text-veld-400 hover:bg-veld-600/20 px-2 py-1 text-xs font-sans"
            >
              Mark credited
            </button>
          ) : staff?.role === "ADMIN" ? (
            <button
              type="button"
              disabled={uncredit.isPending}
              onClick={() => setUndoTarget(d)}
              className="rounded-md border border-ink-700 px-2 py-1 text-xs font-sans hover:bg-ink-800"
            >
              Undo
            </button>
          ) : (
            <span className="text-xs text-sand-200">—</span>
          )}
        </td>
      ),
    };
    return visibleCols.map((c) => cells[c.id]);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">
            Live deposit feed
          </h2>
          <p className="text-sand-200 font-sans mt-1">
            Browse, filter, and export. Work the credit queue under{" "}
            <Link to="/exceptions" className="text-veld-400 hover:underline">
              Pending credits
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative" ref={colMenuRef}>
            <button
              type="button"
              onClick={() => setColMenuOpen((o) => !o)}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-sm font-sans hover:bg-ink-800"
            >
              Columns
            </button>
            {colMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-lg border border-ink-700 bg-ink-900 shadow-fb-md p-2">
                {ALL_COLS.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2 px-2 py-1.5 text-sm font-sans rounded ${
                      c.locked ? "opacity-50" : "hover:bg-ink-800 cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={cols[c.id]}
                      disabled={c.locked}
                      onChange={() => toggleCol(c.id)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void downloadCsv()}
            className="rounded-md border border-ink-700 px-3 py-1.5 text-sm font-sans hover:bg-ink-800 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {showPendingBanner && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-warn/40 bg-[#FFF4D6] px-4 py-3 text-sm font-sans">
          <p className="text-sand-50">
            <span className="text-amber-warn font-semibold">{pendingTotal}</span> pending credit
            {pendingTotal === 1 ? "" : "s"} total
            {datesConstrained ? " — some may be outside this date range" : ""}.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearDatesForPending}
              className="rounded-md border border-ink-700 px-3 py-1 text-xs hover:bg-ink-800"
            >
              Show all pending here
            </button>
            <Link
              to="/exceptions"
              className="rounded-md bg-veld-600 hover:bg-veld-500 text-white px-3 py-1 text-xs"
            >
              Open credit queue
            </Link>
          </div>
        </div>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6 font-sans text-sm">
        <label className="block">
          <span className="text-xs text-sand-200">Status</span>
          <select
            className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="CREDITED">Credited</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-sand-200">Provider</span>
          <select
            className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">All</option>
            <option value="PAYPULSE">PayPulse</option>
            <option value="EASYWALLET">EasyWallet</option>
            <option value="EWALLET">FNB eWallet</option>
            <option value="PAY2CELL">Pay2Cell</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-sand-200">To phone</span>
          <select
            className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
            value={walletNumberId}
            onChange={(e) => setWalletNumberId(e.target.value)}
          >
            <option value="">All</option>
            {(wallets.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.label} ({w.msisdn})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-sand-200">From</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-sand-200">To</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-sand-200">Search</span>
          <input
            className="mt-1 w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Bet acct / ref / sender"
          />
        </label>
      </div>

      {error && <p className="mb-3 text-clay-400 font-sans">{(error as Error).message}</p>}
      {isFetching && isPlaceholderData && (
        <p className="mb-2 text-xs text-sand-200 font-sans">Updating…</p>
      )}

      <div className="overflow-x-auto border border-ink-700 rounded-lg bg-ink-900 shadow-fb max-h-[calc(100vh-16rem)]">
        <table className="w-full text-left text-sm font-sans">
          <thead className="bg-ink-950 text-sand-200 text-xs uppercase tracking-wider sticky top-0 z-10">
            <tr>
              {visibleCols.map((c) => (
                <th key={c.id} className="px-3 py-3">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={isFetching && isPlaceholderData ? "opacity-70" : undefined}>
            {showSkeleton && <FeedSkeleton cols={colCount} />}
            {!showSkeleton &&
              (data ?? []).map((d) => (
                <tr
                  key={d.id}
                  className={`border-t border-ink-800 hover:bg-ink-950 ${ageingClass(d)}`}
                >
                  {renderCells(d)}
                </tr>
              ))}
            {!showSkeleton && data?.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-sand-200">
                  No deposits for these filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creditTarget && (
        <MarkCreditedModal
          deposit={creditTarget}
          busy={mark.isPending}
          error={creditError}
          onClose={() => setCreditTarget(null)}
          onSubmit={async (betAccountId, note) => {
            setCreditError(null);
            await mark.mutateAsync({ id: creditTarget.id, betAccountId, note });
          }}
        />
      )}

      {undoTarget && (
        <ConfirmDialog
          title="Undo credit?"
          body={`${formatNad(undoTarget.amount)} credited to ${undoTarget.creditBetAccountId ?? "—"}${
            undoTarget.creditNote ? `\nNote: ${undoTarget.creditNote}` : ""
          }\n\nThis returns the deposit to pending.`}
          confirmLabel="Undo credit"
          danger
          busy={uncredit.isPending}
          onClose={() => setUndoTarget(null)}
          onConfirm={async () => {
            await uncredit.mutateAsync(undoTarget.id);
          }}
        />
      )}
    </div>
  );
}
