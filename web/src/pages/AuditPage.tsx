import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../lib/auth";
import { auditActionLabel, auditActorLabel, auditDetail } from "../lib/auditLabels";

export default function AuditPage() {
  const { token } = useAuth();
  const { data, isLoading, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.audit(token!),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-sans font-semibold tracking-tight text-3xl text-sand-50">Audit log</h2>
        <p className="text-sand-200/60 font-sans mt-1">Immutable activity history</p>
      </div>
      {isLoading && !data && <p className="text-sand-200/50">Loading…</p>}
      <div
        className={`overflow-x-auto border border-ink-700 rounded-lg bg-ink-900 shadow-fb ${
          isFetching && isPlaceholderData ? "opacity-70" : ""
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
            {(data ?? []).map((l) => (
              <tr key={l.id} className="border-t border-ink-700 align-top">
                <td className="px-4 py-2.5 font-mono text-xs text-sand-200/60 whitespace-nowrap">
                  {new Date(l.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-sand-50">{auditActorLabel(l)}</div>
                  <div className="text-[11px] text-sand-200/45 font-mono uppercase">
                    {l.actorType}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-sand-50">{auditActionLabel(l.action)}</td>
                <td className="px-4 py-2.5 text-xs text-sand-200/65">{auditDetail(l)}</td>
              </tr>
            ))}
            {data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sand-200/40">
                  No audit entries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
