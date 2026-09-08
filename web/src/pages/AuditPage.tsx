import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { AuditLogDto } from "@ewallet/shared";
import { api, type AuditFilters } from "../api/client";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  AUDIT_ACTION_OPTIONS,
  auditActionLabel,
  auditActorLabel,
  auditDetail,
  auditEntityHref,
  auditEntityLinkLabel,
} from "../lib/auditLabels";

const PAGE_SIZE = 50;

const ENTITY_OPTIONS = [
  { value: "", label: "All entities" },
  { value: "DepositEvent", label: "Deposit" },
  { value: "CaptureDevice", label: "Device" },
  { value: "WalletNumber", label: "Wallet" },
  { value: "StaffUser", label: "Staff" },
  { value: "TopupRequest", label: "Top-up" },
];

const ACTOR_OPTIONS = [
  { value: "", label: "All actors" },
  { value: "STAFF", label: "Staff" },
  { value: "DEVICE", label: "Device" },
  { value: "SYSTEM", label: "System" },
];

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function AuditPage() {
  const { token } = useAuth();
  const { push } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [action, setAction] = useState("");
  const [actorType, setActorType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const qDebounced = useDebouncedValue(q, 300);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    const a = searchParams.get("action");
    const at = searchParams.get("actorType");
    const et = searchParams.get("entityType");
    const eid = searchParams.get("entityId");
    const f = searchParams.get("from");
    const t = searchParams.get("to");
    const qq = searchParams.get("q");
    if (a !== null) setAction(a);
    if (at !== null) setActorType(at);
    if (et !== null) setEntityType(et);
    if (eid !== null) setEntityId(eid);
    if (f !== null) setFrom(f);
    if (t !== null) setTo(t);
    if (qq !== null) setQ(qq);
    setUrlReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once from landing URL
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const next = new URLSearchParams();
    if (action) next.set("action", action);
    if (actorType) next.set("actorType", actorType);
    if (entityType) next.set("entityType", entityType);
    if (entityId) next.set("entityId", entityId);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (qDebounced.trim()) next.set("q", qDebounced.trim());
    setSearchParams(next, { replace: true });
  }, [urlReady, action, actorType, entityType, entityId, from, to, qDebounced, setSearchParams]);

  const filters: AuditFilters = useMemo(
    () => ({
      action: action || undefined,
      actorType: actorType || undefined,
      entityType: entityType || undefined,
      entityId: entityId || undefined,
      from: from ? `${from}T00:00:00` : undefined,
      to: to ? `${to}T23:59:59.999` : undefined,
      q: qDebounced.trim() || undefined,
      limit: PAGE_SIZE,
    }),
    [action, actorType, entityType, entityId, from, to, qDebounced]
  );

  const query = useInfiniteQuery({
    queryKey: ["audit", filters],
    queryFn: ({ pageParam }) =>
      api.audit(token!, { ...filters, before: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: !!token && urlReady,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data]
  );

  function clearFilters() {
    setAction("");
    setActorType("");
    setEntityType("");
    setEntityId("");
    setFrom("");
    setTo("");
    setQ("");
  }

  function presetToday() {
    const d = todayInputValue();
    setFrom(d);
    setTo(d);
  }

  async function downloadCsv() {
    setExporting(true);
    try {
      const url = api.auditExportCsvUrl(filters);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ewallet-audit-${todayInputValue()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      push("Audit CSV exported", "success");
    } catch (e) {
      push(e instanceof Error ? e.message : "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">Audit log</h2>
          <p className="text-sand-200/60 font-sans mt-1">Append-only activity history</p>
        </div>
        <button
          type="button"
          disabled={exporting || !token}
          onClick={() => void downloadCsv()}
          className="rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm font-sans text-sand-50 hover:bg-ink-800 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 items-end">
        <label className="text-xs font-sans text-sand-200/70">
          Action
          <select
            className="mt-1 block rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm text-sand-50 min-w-[10rem]"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">All actions</option>
            {AUDIT_ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-sans text-sand-200/70">
          Who
          <select
            className="mt-1 block rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm text-sand-50"
            value={actorType}
            onChange={(e) => setActorType(e.target.value)}
          >
            {ACTOR_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-sans text-sand-200/70">
          Entity
          <select
            className="mt-1 block rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm text-sand-50"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-sans text-sand-200/70">
          From
          <input
            type="date"
            className="mt-1 block rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm text-sand-50"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs font-sans text-sand-200/70">
          To
          <input
            type="date"
            className="mt-1 block rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm text-sand-50"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="text-xs font-sans text-sand-200/70 flex-1 min-w-[12rem]">
          Search
          <input
            className="mt-1 block w-full rounded-md bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm text-sand-50"
            placeholder="Action, entity id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={presetToday}
          className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs font-sans text-sand-200 hover:bg-ink-800"
        >
          Today
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-md border border-ink-700 px-2.5 py-1.5 text-xs font-sans text-sand-200 hover:bg-ink-800"
        >
          Clear
        </button>
      </div>

      {entityId && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-sans">
          <span className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sand-200">
            Entity id · <span className="font-mono text-sand-50">{entityId}</span>
          </span>
          <button
            type="button"
            className="text-sand-200 hover:underline"
            onClick={() => setEntityId("")}
          >
            Clear entity
          </button>
        </div>
      )}

      {query.isLoading && !query.data && <p className="text-sand-200/50">Loading…</p>}
      <div
        className={`overflow-x-auto border border-ink-700 rounded-lg bg-ink-900 shadow-fb ${
          query.isFetching && query.isPlaceholderData ? "opacity-70" : ""
        }`}
      >
        <table className="w-full text-left text-sm font-sans">
          <thead className="bg-ink-950 text-sand-200/60 text-xs uppercase tracking-wider sticky top-0">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Who</th>
              <th className="px-4 py-3">What</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <AuditRow
                key={l.id}
                log={l}
                expanded={expandedId === l.id}
                onToggle={() => setExpandedId((id) => (id === l.id ? null : l.id))}
              />
            ))}
            {rows.length === 0 && !query.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sand-200/40">
                  No audit entries match these filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            className="rounded-md border border-ink-700 bg-ink-900 px-4 py-2 text-sm font-sans text-sand-50 hover:bg-ink-800 disabled:opacity-50"
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

function AuditRow({
  log,
  expanded,
  onToggle,
}: {
  log: AuditLogDto;
  expanded: boolean;
  onToggle: () => void;
}) {
  const href = auditEntityHref(log);
  const metaJson =
    log.metadata && Object.keys(log.metadata).length > 0
      ? JSON.stringify(log.metadata, null, 2)
      : null;

  return (
    <>
      <tr className="border-t border-ink-700 align-top">
        <td className="px-4 py-2.5 font-mono text-xs text-sand-200/60 whitespace-nowrap">
          {new Date(log.createdAt).toLocaleString()}
        </td>
        <td className="px-4 py-2.5">
          <div className="text-sand-50">{auditActorLabel(log)}</div>
          <div className="text-[11px] text-sand-200/45 font-mono uppercase">{log.actorType}</div>
        </td>
        <td className="px-4 py-2.5 text-sand-50">{auditActionLabel(log.action)}</td>
        <td className="px-4 py-2.5 text-xs text-sand-200/65">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <span>{auditDetail(log)}</span>
            {href && (
              <Link to={href} className="text-veld-400 hover:underline shrink-0">
                Open {auditEntityLinkLabel(log).split(" · ")[0]}
              </Link>
            )}
            {metaJson && (
              <button
                type="button"
                onClick={onToggle}
                className="text-sand-200/80 hover:text-sand-50 underline shrink-0"
              >
                {expanded ? "Hide JSON" : "Raw"}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && metaJson && (
        <tr className="border-t border-ink-800 bg-ink-950/60">
          <td colSpan={4} className="px-4 py-3">
            <pre className="text-[11px] font-mono text-sand-200/80 whitespace-pre-wrap break-all overflow-x-auto">
              {metaJson}
            </pre>
            <p className="mt-2 text-[11px] font-mono text-sand-200/45">
              {log.entityType} · {log.entityId}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
