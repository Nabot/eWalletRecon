import { PrismaClient } from "@prisma/client";

const client = new PrismaClient();

// Soft append-only guard (DB triggers also deny UPDATE/DELETE when migrated).
client.$use(async (params, next) => {
  if (
    params.model === "AuditLog" &&
    (params.action === "update" ||
      params.action === "updateMany" ||
      params.action === "delete" ||
      params.action === "deleteMany")
  ) {
    throw new Error("AuditLog is append-only");
  }
  return next(params);
});

export const prisma = client;
