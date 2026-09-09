import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { DepositChannel, DepositEventDto } from "@ewallet/shared";
import { api, formatNad, ageingClass, ageingLabel } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { AgeingChip, ChannelBadge, StatusBadge } from "../components/StatusBadge";
import MarkCreditedModal from "../components/MarkCreditedModal";
import PstBetCreditModal from "../components/PstBetCreditModal";
import { formatSender } from "../lib/sender";
import { providerLabel } from "../lib/providers";

type ChannelFilter = "" | DepositChannel;

export default function ExceptionsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { push } = useToast();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<DepositEventDto | null>(null);
  const [pstbetTarget, setPstbetTarget] = useState<DepositEventDto | null>(null);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [pstbetError, setPstbetError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("");

  const { data, isLoading, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["exceptions", channelFilter || "ALL"],
    queryFn: () => api.exceptions(token!, channelFilter || undefined),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });

  const pstbetStatus = useQuery({
    queryKey: ["pstbet-status"],
    queryFn: () => api.pstbetStatus(token!),
    enabled: !!token,
    staleTime: 60_000,
  });
  const pstbetConfigured = pstbetStatus.data?.configured === true;

  const sorted = useMemo(() => {
    const rows = [...(data ?? [])];
    rows.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
    return rows;
  }, [data]);

  useEffect(() => {
    if (!sorted.length) {
      setCursor(0);
      return;
    }
    if (searchParams.get("focus") === "oldest") {
      setCursor(0);
      requestAnimationFrame(() => {
        document.getElementById(`pending-${sorted[0].id}`)?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      });
    }
  }, [sorted, searchParams]);

  useEffect(() => {
    if (cursor >= sorted.length) setCursor(Math.max(0, sorted.length - 1));
  }, [cursor, sorted.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (selected || pstbetTarget) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, Math.max(0, sorted.length - 1)));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        const row = sorted[cursor];
        if (!row) return;
        e.preventDefault();
        if (pstbetConfigured) {
          setPstbetError(null);
          setPstbetTarget(row);
        } else {
          setCreditError(null);
          setSelected(row);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cursor, selected, pstbetTarget, sorted, pstbetConfigured]);

  useEffect(() => {
    const row = sorted[cursor];
    if (!row) return;
    document.getElementById(`pending-${row.id}`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, sorted]);

  function invalidateCreditQueries() {
    void qc.invalidateQueries({ queryKey: ["exceptions"] });
    void qc.invalidateQueries({ queryKey: ["deposits"] });
    void qc.invalidateQueries({ queryKey: ["pending-count"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
    void qc.invalidateQueries({ queryKey: ["daily-closeout"] });
  }

  const mark = useMutation({
    mutationFn: ({ id, betAccountId, note }: { id: string; betAccountId: string; note: string }) =>
      api.markCredited(token!, id, betAccountId, note || undefined),
    onSuccess: (_res, vars) => {
      const amount = selected ? formatNad(selected.amount) : "";
      setSelected(null);
      setCreditError(null);
      push(`Credited ${amount} → ${vars.betAccountId}`, "success");
      invalidateCreditQueries();
    },
    onError: (e: Error) => setCreditError(e.message),
  });

  const pstbetCredit = useMutation({
    mutationFn: (vars: {
      id: string;
      userId: number;
      userName: string;
      mobile: string;
      note: string;
    }) =>
      api.pstbetCredit(token!, vars.id, {
        userId: vars.userId,
        userName: vars.userName,
        mobile: vars.mobile,
        note: vars.note || undefined,
      }),
    onSuccess: (res) => {
      const amount = pstbetTarget ? formatNad(pstbetTarget.amount) : "";
      setPstbetTarget(null);
      setPstbetError(null);
      const ref = res.ourReference ? ` · ${res.ourReference}` : "";
      push(`PstBet credited ${amount} → ${res.betAccountId}${ref}`, "success");
      invalidateCreditQueries();
    },
    onError: (e: Error) => setPstbetError(e.message),
  });

  const chipClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-sans ${
      active
        ? "bg-veld-600/30 text-veld-400 font-semibold ring-1 ring-veld-500/40"
        : "border border-ink-700 text-sand-200 hover:bg-ink-800"
    }`;

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">Pending credits</h2>
        <p className="text-sand-200 font-sans mt-1">
          Shared credit queue — oldest first.{" "}
          <span className="text-sand-200">
            Shortcuts: <kbd className="font-mono text-xs border border-ink-700 rounded px-1">j</kbd>/
            <kbd className="font-mono text-xs border border-ink-700 rounded px-1">k</kbd> move,{" "}
            <kbd className="font-mono text-xs border border-ink-700 rounded px-1">Enter</kbd>{" "}
            {pstbetConfigured ? "credit via PstBet" : "mark credited"}.
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={chipClass(channelFilter === "")} onClick={() => setChannelFilter("")}>
            All
          </button>
          <button
            type="button"
            className={chipClass(channelFilter === "WALLET")}
            onClick={() => setChannelFilter("WALLET")}
          >
            Wallets
          </button>
          <button
            type="button"
            className={chipClass(channelFilter === "BANK")}
            onClick={() => setChannelFilter("BANK")}
          >
            Banks
          </button>
        </div>
      </div>

      <div
        className={`border border-ink-700 rounded-lg overflow-hidden bg-ink-900 shadow-fb ${
          isFetching && isPlaceholderData ? "opacity-70" : ""
        }`}
      >
        {isLoading && !data && (
          <div className="space-y-0 divide-y divide-ink-800">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <div className="h-4 w-28 rounded bg-ink-800 animate-pulse" />
                <div className="mt-2 h-3 w-2/3 rounded bg-ink-800 animate-pulse" />
              </div>
            ))}
          </div>
        )}
        <ul className="divide-y divide-ink-800">
          {sorted.map((d, i) => {
            const age = ageingLabel(d);
            const active = i === cursor;
            return (
              <li
                key={d.id}
                id={`pending-${d.id}`}
                className={`${ageingClass(d)} ${
                  active ? "ring-2 ring-inset ring-veld-500 bg-veld-600/10" : ""
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setCursor(i)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base text-sand-50 tabular-nums">
                        {formatNad(d.amount)}
                      </span>
                      <StatusBadge status={d.matchStatus} />
                      <ChannelBadge channel={d.channel} />
                      {age && <AgeingChip age={age} />}
                    </div>
                    <div className="text-xs text-sand-200 mt-1">
                      {providerLabel(d.provider)} · {d.walletNumber?.label} · {formatSender(d)} ·{" "}
                      {d.reference ?? "no ref"}
                    </div>
                    <p className="text-xs text-sand-200 mt-1 line-clamp-1 font-sans">{d.rawMessage}</p>
                  </button>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {pstbetConfigured && (
                      <button
                        type="button"
                        onClick={() => {
                          setCursor(i);
                          setPstbetError(null);
                          setPstbetTarget(d);
                        }}
                        className="rounded-md bg-veld-600 hover:bg-veld-500 text-white px-3 py-1.5 text-sm font-sans font-semibold"
                      >
                        Credit via PstBet
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setCursor(i);
                        setCreditError(null);
                        setSelected(d);
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm font-sans font-semibold ${
                        pstbetConfigured
                          ? "border border-ink-700 hover:bg-ink-800 text-sand-50"
                          : "bg-veld-600 hover:bg-veld-500 text-white"
                      }`}
                    >
                      Mark credited
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          {!isLoading && sorted.length === 0 && (
            <li className="p-8 text-center text-sand-200 font-sans">All caught up</li>
          )}
        </ul>
      </div>

      {selected && (
        <MarkCreditedModal
          deposit={selected}
          busy={mark.isPending}
          error={creditError}
          onClose={() => setSelected(null)}
          onSubmit={async (betAccountId, note) => {
            setCreditError(null);
            await mark.mutateAsync({ id: selected.id, betAccountId, note });
          }}
        />
      )}

      {pstbetTarget && (
        <PstBetCreditModal
          deposit={pstbetTarget}
          busy={pstbetCredit.isPending}
          error={pstbetError}
          onClose={() => {
            setPstbetTarget(null);
            setPstbetError(null);
          }}
          onLookup={(mobile) => api.pstbetLookup(token!, pstbetTarget.id, mobile)}
          onConfirm={async (params) => {
            setPstbetError(null);
            await pstbetCredit.mutateAsync({ id: pstbetTarget.id, ...params });
          }}
        />
      )}
    </div>
  );
}
