import { prisma } from "./prisma";
import { ActorType, Prisma } from "@prisma/client";

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
  return client.auditLog.create({
    data: {
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata ?? undefined,
    },
  });
}
