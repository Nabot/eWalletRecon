import type { MatchStatus } from "@ewallet/shared";

/** Staff-facing: MATCHED = credited; everything else needs credit. */
export function StatusBadge({ status }: { status: MatchStatus }) {
  const credited = status === "MATCHED";
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs font-mono uppercase tracking-wide ${
        credited ? "status-matched" : "status-pending"
      }`}
    >
      {credited ? "CREDITED" : "PENDING"}
    </span>
  );
}

export function AgeingChip({ age }: { age: string }) {
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide ${
        age === ">24h"
          ? "bg-[#FDE8EC] text-clay-500 ring-1 ring-clay-400/30"
          : "bg-[#FFF4D6] text-[#B07800] ring-1 ring-amber-warn/40"
      }`}
    >
      {age}
    </span>
  );
}
