import type { AuditLogDto } from "@ewallet/shared";
import { formatNad } from "../api/client";

export const ACTION_LABELS: Record<string, string> = {
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
  DEVICE_REBOUND: "Capture phone rebound to wallet",
  DEVICE_NOTES_UPDATED: "Capture phone notes updated",
  DEVICE_FORCE_SYNC: "Force sync requested",
  DEVICE_PING: "Ping requested",
  DEVICE_WIPE_REQUESTED: "Remote wipe requested",
  SMS_BATCH_SYNC: "SMS batch synced",
  ADMIN_REPARSE: "Admin reparse",
  STAFF_LOGIN: "Staff signed in",
  STAFF_LOGIN_FAILED: "Staff sign-in failed",
  STAFF_LOGOUT: "Staff signed out",
};

/** Options for the Audit filter dropdown (label → action code). */
export const AUDIT_ACTION_OPTIONS = Object.entries(ACTION_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

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

export function auditEntityHref(log: AuditLogDto): string | null {
  if (log.entityType === "DepositEvent" && log.entityId && log.entityId !== "batch") {
    return `/?q=${encodeURIComponent(log.entityId)}`;
  }
  if (log.entityType === "CaptureDevice" && log.entityId) {
    return `/devices?device=${encodeURIComponent(log.entityId)}`;
  }
  return null;
}

export function auditEntityLinkLabel(log: AuditLogDto): string {
  const m = log.metadata ?? {};
  if (log.entityType === "DepositEvent") {
    if (log.entityId === "batch") return "Deposit batch";
    return `Deposit ${log.entityId.slice(0, 8)}…`;
  }
  if (log.entityType === "CaptureDevice") {
    const name =
      (typeof m.deviceName === "string" && m.deviceName) ||
      (typeof m.name === "string" && m.name) ||
      null;
    return name ? `Device · ${name}` : `Device ${log.entityId.slice(0, 8)}…`;
  }
  if (log.entityType === "StaffUser") return "Staff account";
  if (log.entityType === "TopupRequest") return `Top-up ${log.entityId.slice(0, 8)}…`;
  return `${log.entityType} · ${log.entityId.slice(0, 8)}…`;
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
  if (typeof m.email === "string" && m.email) parts.push(m.email);
  if (typeof m.deviceName === "string" && m.deviceName) parts.push(m.deviceName);
  else if (typeof m.name === "string" && m.name && log.entityType === "CaptureDevice") {
    parts.push(m.name);
  }

  if (parts.length === 0) return auditEntityLinkLabel(log);
  return `${auditEntityLinkLabel(log)}: ${parts.join(" · ")}`;
}
