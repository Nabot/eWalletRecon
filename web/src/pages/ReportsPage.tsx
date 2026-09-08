import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, formatNad } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { providerLabel } from "../lib/providers";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function feedLink(opts: {
  status?: string;
  walletNumberId?: string;
  from: string;
  to: string;
}) {
  const p = new URLSearchParams();
  if (opts.status) p.set("status", opts.status);
  if (opts.walletNumberId) p.set("walletNumberId", opts.walletNumberId);
  p.set("from", opts.from);
  p.set("to", opts.to);
  return `/?${p.toString()}`;
}

export default function ReportsPage() {
  const { token } = useAuth();
  const { push } = useToast();
  const [date, setDate] = useState(today());
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [exporting, setExporting] = useState(false);

  const closeout = useQuery({
    queryKey: ["daily-closeout", date, period],
    queryFn: () => api.dailyCloseout(token!, date, period),
    enabled: !!token,
  });

  const range = useMemo(() => {
    const to = closeout.data?.to ?? date;
    const from = closeout.data?.from ?? date;
    return { from, to };
  }, [closeout.data, date]);

  async function downloadCsv() {
    setExporting(true);
    try {
      const url = api.exportCsvUrl({
        from: `${range.from}T00:00:00`,
        to: `${range.to}T23:59:59.999`,
      });
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ewallet-closeout-${period}-${range.from}-to-${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      push("CSV exported", "success");
    } catch (e) {
      push(e instanceof Error ? e.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  const t = closeout.data?.totals;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">
            {period === "week" ? "Weekly close-out" : "Daily close-out"}
          </h2>
          <p className="text-sand-200 font-sans mt-1">
            Received vs credited vs pending per wallet phone (NAD)
            {period === "week" ? ` · ${range.from} → ${range.to}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-sans text-sm">
          <div className="flex rounded-md border border-ink-700 overflow-hidden">
            {(["day", "week"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 ${
                  period === p ? "bg-veld-600/30 text-veld-400 font-semibold" : "text-sand-200 hover:bg-ink-800"
                }`}
              >
                {p === "day" ? "Today" : "Last 7 days"}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md bg-ink-950 border border-ink-700 px-3 py-1.5"
            title={period === "week" ? "Week ending on this date" : "Close-out date"}
          />
          <button
            type="button"
            disabled={exporting}
            onClick={() => void downloadCsv()}
            className="rounded-md border border-ink-700 px-3 py-1.5 hover:bg-ink-800 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {closeout.isLoading && <p className="text-sand-200">Loading…</p>}
      {closeout.error && (
        <p className="text-clay-400">{(closeout.error as Error).message}</p>
      )}

      {t && (
        <div className="mb-6 grid sm:grid-cols-3 gap-3">
          <div className="border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb">
            <div className="text-xs text-sand-200 font-sans uppercase tracking-wide">Received</div>
            <div className="mt-1 font-mono text-xl text-sand-50">{formatNad(t.receivedAmount)}</div>
            <div className="text-xs text-sand-200 font-mono">{t.receivedCount} deposits</div>
          </div>
          <div className="border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb">
            <div className="text-xs text-sand-200 font-sans uppercase tracking-wide">Credited</div>
            <div className="mt-1 font-mono text-xl text-veld-400">{formatNad(t.creditedAmount)}</div>
            <div className="text-xs text-sand-200 font-mono">{t.creditedCount} deposits</div>
          </div>
          <Link
            to={feedLink({ status: "PENDING", from: range.from, to: range.to })}
            className="border border-ink-700 rounded-lg p-4 bg-ink-900 shadow-fb hover:border-clay-400 transition block"
          >
            <div className="text-xs text-sand-200 font-sans uppercase tracking-wide">Still pending</div>
            <div className="mt-1 font-mono text-xl text-clay-400">{formatNad(t.pendingAmount)}</div>
            <div className="text-xs text-sand-200 font-mono">
              {t.pendingCount} deposits · open in feed
            </div>
          </Link>
        </div>
      )}

      <div className="overflow-x-auto border border-ink-700 rounded-lg bg-ink-900 shadow-fb">
        <table className="w-full text-left text-sm font-sans">
          <thead className="bg-ink-950 text-sand-200 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Wallet phone</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Credited</th>
              <th className="px-4 py-3">Pending</th>
            </tr>
          </thead>
          <tbody>
            {(closeout.data?.wallets ?? []).map((w) => (
              <tr key={w.walletNumberId} className="border-t border-ink-800">
                <td className="px-4 py-3">
                  <div>{w.label}</div>
                  <div className="font-mono text-xs text-sand-200">{w.msisdn}</div>
                </td>
                <td className="px-4 py-3">{providerLabel(w.provider)}</td>
                <td className="px-4 py-3 font-mono">
                  {formatNad(w.receivedAmount)}
                  <div className="text-xs text-sand-200">{w.receivedCount}</div>
                </td>
                <td className="px-4 py-3 font-mono text-veld-400">
                  {formatNad(w.creditedAmount)}
                  <div className="text-xs text-sand-200">{w.creditedCount}</div>
                </td>
                <td className="px-4 py-3">
                  {w.pendingCount > 0 ? (
                    <Link
                      to={feedLink({
                        status: "PENDING",
                        walletNumberId: w.walletNumberId,
                        from: range.from,
                        to: range.to,
                      })}
                      className="font-mono text-clay-400 hover:underline"
                    >
                      {formatNad(w.pendingAmount)}
                      <div className="text-xs">{w.pendingCount} · view</div>
                    </Link>
                  ) : (
                    <span className="font-mono text-sand-200">
                      {formatNad(w.pendingAmount)}
                      <div className="text-xs">0</div>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
