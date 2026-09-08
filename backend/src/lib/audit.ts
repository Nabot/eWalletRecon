import { prisma } from "./prisma";
import { ActorType, Prisma } from "@prisma/client";
import { broadcast } from "../ws/hub";

type AuditRow = {
  id: string;
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

export type AuditFilters = {
  action?: string;
  actorType?: ActorType;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  from?: Date | null;
  to?: Date | null;
  before?: Date | null;
  q?: string;
};

export function buildAuditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (filters.action) where.action = filters.action;
  if (filters.actorType) where.actorType = filters.actorType;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;

  const createdAt: Prisma.DateTimeFilter = {};
  if (filters.from && !Number.isNaN(filters.from.getTime())) createdAt.gte = filters.from;
  if (filters.to && !Number.isNaN(filters.to.getTime())) createdAt.lte = filters.to;
  if (filters.before && !Number.isNaN(filters.before.getTime())) createdAt.lt = filters.before;
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { action: { contains: q } },
      { entityId: { contains: q } },
      { actorId: { contains: q } },
      { entityType: { contains: q } },
    ];
  }

  return where;
}

function metadataName(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m.deviceName === "string" && m.deviceName.trim()) return m.deviceName.trim();
  if (typeof m.name === "string" && m.name.trim()) return m.name.trim();
  if (typeof m.email === "string" && m.email.trim()) return m.email.trim();
  return null;
}

export async function attachActorLabels<T extends AuditRow>(logs: T[]) {
  const staffIds = [...new Set(logs.filter((l) => l.actorType === "STAFF").map((l) => l.actorId))];
  const deviceIds = [...new Set(logs.filter((l) => l.actorType === "DEVICE").map((l) => l.actorId))];

  const [staffRows, deviceRows] = await Promise.all([
    staffIds.length
      ? prisma.staffUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, email: true } })
      : Promise.resolve([]),
    deviceIds.length
      ? prisma.captureDevice.findMany({
          where: { id: { in: deviceIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const staffMap = new Map(staffRows.map((s) => [s.id, s.email]));
  const deviceMap = new Map(deviceRows.map((d) => [d.id, d.name]));

  return logs.map((l) => {
    const fromMeta = metadataName(l.metadata);
    let actorLabel: string | null = null;
    if (l.actorType === "STAFF") actorLabel = staffMap.get(l.actorId) ?? fromMeta ?? "Staff";
    else if (l.actorType === "DEVICE") actorLabel = deviceMap.get(l.actorId) ?? fromMeta ?? "Device";
    else if (l.actorType === "SYSTEM") actorLabel = "System";

    return {
      id: l.id,
      actorType: l.actorType,
      actorId: l.actorId,
      actorLabel,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      metadata: (l.metadata as Record<string, unknown> | null) ?? null,
      createdAt: l.createdAt.toISOString(),
    };
  });
}

export async function writeAuditLog(params: {
  actorType: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
}) {
  const client = params.tx ?? prisma;
  const row = await client.auditLog.create({
    data: {
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata ?? undefined,
    },
  });

  // Skip live push while still inside a DB transaction (caller may roll back).
  if (!params.tx) {
    broadcast({ type: "audit.created", payload: { id: row.id, action: row.action } });
  }

  return row;
}
