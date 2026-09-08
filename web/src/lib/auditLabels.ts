import type { AuditLogDto } from "@ewallet/shared";
import { formatNad } from "../api/client";

const ACTION_LABELS: Record<string, string> = {
  DEPOSIT_INGESTED: "Deposit received",
  DEPOSIT_MARKED_CREDITED: "Marked as credited",
  DEPOSIT_UNCREDITED: "Credit undone",
  DEPOSIT_MATCHED_CREDITED: "Auto-matched & credited",
  DEPOSIT_UNMATCHED: "Left unmatched",
  DEPOSIT_FLAGGED_MANUAL: "Flagged for manual review",
  TOPUP_CREATED: "Top-up request created",
  DEVICE_CREATED: "Capture phone registered",
  DEVICE_RENAMED: "Capture phone renamed",
  DEVICE_KEY_ROTATED: "Capture phone key rotated",
  DEVICE_REVOKED: "Capture phone revoked",
  SMS_BATCH_SYNC: "SMS batch synced",
  ADMIN_REPARSE: "Admin reparse",
  STAFF_LOGIN: "Staff signed in",
};

const ACTOR_LABELS: Record<string, string> = {
  STAFF: "Staff",
  DEVICE: "Device",
  SYSTEM: "System",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ").toLowerCase();
}

export function auditActorLabel(log: AuditLogDto & { actorLabel?: string | null }): string {
  if (log.actorLabel) return log.actorLabel;
  const kind = ACTOR_LABELS[log.actorType] ?? log.actorType;
  return kind;
}

export function auditDetail(log: AuditLogDto): string {
  const m = log.metadata ?? {};
  const parts: string[] = [];

  if (typeof m.amount === "number") parts.push(formatNad(m.amount));
  if (typeof m.betAccountId === "string" && m.betAccountId) parts.push(`→ ${m.betAccountId}`);
  if (typeof m.previousBetAccountId === "string" && m.previousBetAccountId) {
    parts.push(`was ${m.previousBetAccountId}`);
  }
  if (typeof m.reference === "string" && m.reference) parts.push(`ref ${m.reference}`);
  if (typeof m.reason === "string" && m.reason) parts.push(m.reason);
  if (typeof m.note === "string" && m.note) parts.push(m.note);

  const entity =
    log.entityType === "DepositEvent"
      ? "Deposit"
      : log.entityType === "CaptureDevice"
        ? "Device"
        : log.entityType;

  if (parts.length === 0) return `${entity} · ${log.entityId.slice(0, 8)}…`;
  return `${entity}: ${parts.join(" · ")}`;
}
