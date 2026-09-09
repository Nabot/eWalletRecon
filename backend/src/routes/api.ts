import { Router } from "express";
import { z } from "zod";
import { MatchStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireStaff, requireRole } from "../middleware/auth";
import { markDepositCredited, uncreditDeposit } from "../services/matching/manualCredit";
import { creditDepositViaPstBet, lookupPstBetForDeposit } from "../services/pstbet/credit";
import { PstBetApiError } from "../services/pstbet/client";
import { parseSmsWithFallback } from "../services/parsers";
import { attachActorLabels, buildAuditWhere, writeAuditLog } from "../lib/audit";
import { toNumber } from "../lib/money";
import { config, isPstBetConfigured } from "../config/env";
import { generateApiKey, generateRefCode, hashApiKey } from "../lib/crypto";
import { toDeviceDto } from "../services/devices/deviceDto";
import type { ActorType } from "@prisma/client";

function pstbetHttpStatus(e: unknown): number {
  if (!(e instanceof PstBetApiError)) return 400;
  if (e.code === "CONFIG") return 503;
  if (e.code === "AUTH") return 502;
  if (e.code === "NETWORK") return 502;
  if (e.code === "NOT_FOUND") return 404;
  if (e.code === "AMOUNT") return 400;
  return 400;
}

export const apiRouter = Router();
apiRouter.use(requireStaff);

function serializeDeposit<
  T extends {
    amount: Prisma.Decimal;
    receivedAt: Date;
    createdAt: Date;
    creditedAt?: Date | null;
  },
>(e: T) {
  return {
    ...e,
    amount: toNumber(e.amount),
    receivedAt: e.receivedAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
    creditedAt: e.creditedAt ? e.creditedAt.toISOString() : null,
  };
}

function pendingWhere(): Prisma.DepositEventWhereInput {
  return { matchStatus: { in: ["UNMATCHED", "MANUAL", "PENDING"] } };
}

// --- Deposits ---
apiRouter.get("/deposits", async (req, res) => {
  const statusParam = String(req.query.status ?? "").toUpperCase();
  const provider = String(req.query.provider ?? "").toUpperCase();
  const channelParam = String(req.query.channel ?? "").toUpperCase();
  const walletNumberId = String(req.query.walletNumberId ?? "").trim();
  const q = String(req.query.q ?? "").trim();
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  const take = Math.min(Number(req.query.limit ?? 100), 500);

  const where: Prisma.DepositEventWhereInput = {};

  if (statusParam === "PENDING") {
    Object.assign(where, pendingWhere());
  } else if (statusParam === "CREDITED" || statusParam === "MATCHED") {
    where.matchStatus = "MATCHED";
  } else if (statusParam && ["UNMATCHED", "MANUAL", "PENDING", "MATCHED"].includes(statusParam)) {
    where.matchStatus = statusParam as MatchStatus;
  }

  if (channelParam === "WALLET" || channelParam === "BANK") {
    where.channel = channelParam;
  }

  if (
    provider &&
    ["PAYPULSE", "EASYWALLET", "PAY2CELL", "EWALLET", "BANK_WHK"].includes(provider)
  ) {
    where.provider = provider as Prisma.EnumWalletProviderFilter["equals"];
  }
  if (walletNumberId) where.walletNumberId = walletNumberId;

  if (from || to) {
    where.receivedAt = {};
    if (from && !Number.isNaN(from.getTime())) where.receivedAt.gte = from;
    if (to && !Number.isNaN(to.getTime())) where.receivedAt.lte = to;
  }

  if (q) {
    // MySQL: no Prisma `mode: "insensitive"` (Postgres-only). utf8mb4_unicode_ci is CI by default.
    where.OR = [
      { id: { equals: q } },
      { creditBetAccountId: { contains: q } },
      { creditNote: { contains: q } },
      { reference: { contains: q } },
      { senderMsisdn: { contains: q } },
      { senderName: { contains: q } },
      { rawMessage: { contains: q } },
    ];
  }

  const deposits = await prisma.depositEvent.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take,
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });
  res.json(deposits.map(serializeDeposit));
});

apiRouter.get("/deposits/export.csv", async (req, res) => {
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(new Date().setHours(0, 0, 0, 0));
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const walletNumberId = String(req.query.walletNumberId ?? "").trim();
  const channelParam = String(req.query.channel ?? "").toUpperCase();

  const where: Prisma.DepositEventWhereInput = {
    receivedAt: { gte: from, lte: to },
  };
  if (walletNumberId) where.walletNumberId = walletNumberId;
  if (channelParam === "WALLET" || channelParam === "BANK") {
    where.channel = channelParam;
  }

  const deposits = await prisma.depositEvent.findMany({
    where,
    orderBy: { receivedAt: "asc" },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const header = [
    "receivedAt",
    "channel",
    "provider",
    "toPhone",
    "toLabel",
    "amount",
    "currency",
    "sender",
    "reference",
    "status",
    "betAccountId",
    "creditNote",
    "creditedAt",
    "id",
  ].join(",");

  const rows = deposits.map((d) =>
    [
      esc(d.receivedAt.toISOString()),
      esc(d.channel),
      esc(d.provider),
      esc(d.walletNumber.msisdn),
      esc(d.walletNumber.label),
      esc(toNumber(d.amount)),
      esc(d.currency),
      esc(d.senderMsisdn ?? d.senderName),
      esc(d.reference),
      esc(d.matchStatus === "MATCHED" ? "CREDITED" : "PENDING"),
      esc(d.creditBetAccountId),
      esc(d.creditNote),
      esc(d.creditedAt?.toISOString()),
      esc(d.id),
    ].join(",")
  );

  const day = from.toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ewallet-deposits-${day}.csv"`);
  res.send([header, ...rows].join("\n"));
});

apiRouter.get("/deposits/pending-count", async (_req, res) => {
  const count = await prisma.depositEvent.count({ where: pendingWhere() });
  res.json({ count });
});

apiRouter.get("/deposits/:id", async (req, res) => {
  const deposit = await prisma.depositEvent.findUnique({
    where: { id: req.params.id },
    include: {
      walletNumber: true,
      matchedTopupRequest: { include: { user: true } },
      creditLedger: true,
    },
  });
  if (!deposit) return res.status(404).json({ error: "Not found" });
  res.json({
    ...serializeDeposit(deposit),
    matchedTopupRequest: deposit.matchedTopupRequest
      ? {
          ...deposit.matchedTopupRequest,
          expectedAmount:
            deposit.matchedTopupRequest.expectedAmount != null
              ? toNumber(deposit.matchedTopupRequest.expectedAmount)
              : null,
        }
      : null,
    creditLedger: deposit.creditLedger
      ? { ...deposit.creditLedger, amount: toNumber(deposit.creditLedger.amount) }
      : null,
  });
});

apiRouter.get("/exceptions", async (req, res) => {
  const channelParam = String(req.query.channel ?? "").toUpperCase();
  const where: Prisma.DepositEventWhereInput = { ...pendingWhere() };
  if (channelParam === "WALLET" || channelParam === "BANK") {
    where.channel = channelParam;
  }

  const deposits = await prisma.depositEvent.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 100,
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });
  res.json(deposits.map(serializeDeposit));
});

/** Staff marks deposit as credited on the betting account (manual process). */
apiRouter.post("/deposits/:id/mark-credited", async (req, res) => {
  const body = z
    .object({
      betAccountId: z.string().min(1).max(64),
      note: z.string().max(500).optional().nullable(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  try {
    const outcome = await markDepositCredited({
      depositEventId: req.params.id,
      staffId: req.staff!.staffId,
      betAccountId: body.data.betAccountId,
      note: body.data.note,
    });
    res.json(outcome);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Mark credited failed" });
  }
});

/** Whether PstBet assisted credit is available. */
apiRouter.get("/pstbet/status", async (_req, res) => {
  res.json({
    configured: isPstBetConfigured(),
    shopName: isPstBetConfigured() ? config.pstbet.shopName : null,
    minAmount: config.pstbet.minAmount,
    maxAmount: config.pstbet.maxAmount,
  });
});

/** Look up PstBet account for a deposit (by sender MSISDN or override mobile). */
apiRouter.post("/deposits/:id/pstbet-lookup", async (req, res) => {
  const body = z
    .object({
      mobile: z.string().min(8).max(20).optional().nullable(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  try {
    const result = await lookupPstBetForDeposit({
      depositEventId: req.params.id,
      mobileOverride: body.data.mobile,
    });
    res.json(result);
  } catch (e) {
    res.status(pstbetHttpStatus(e)).json({
      error: e instanceof Error ? e.message : "PstBet lookup failed",
    });
  }
});

/** Confirm and credit deposit via PstBet top-up API. */
apiRouter.post("/deposits/:id/pstbet-credit", async (req, res) => {
  const body = z
    .object({
      userId: z.number().int().positive(),
      userName: z.string().min(1).max(128),
      mobile: z.string().min(8).max(20),
      note: z.string().max(500).optional().nullable(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  try {
    const outcome = await creditDepositViaPstBet({
      depositEventId: req.params.id,
      staffId: req.staff!.staffId,
      userId: body.data.userId,
      userName: body.data.userName,
      mobile: body.data.mobile,
      note: body.data.note,
    });
    res.json(outcome);
  } catch (e) {
    res.status(pstbetHttpStatus(e)).json({
      error: e instanceof Error ? e.message : "PstBet credit failed",
    });
  }
});

/** Admin: undo a manual credit. */
apiRouter.post("/deposits/:id/uncredit", requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({ reason: z.string().max(500).optional().nullable() })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  try {
    const outcome = await uncreditDeposit({
      depositEventId: req.params.id,
      staffId: req.staff!.staffId,
      reason: body.data.reason,
    });
    res.json(outcome);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Uncredit failed" });
  }
});

// --- Users & top-ups ---
apiRouter.get("/users", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { betAccountId: { contains: q } },
            { registeredMsisdn: { contains: q } },
          ],
        }
      : undefined,
    take: 50,
    orderBy: { name: "asc" },
  });
  res.json(users);
});

apiRouter.get("/topups", async (req, res) => {
  const status = req.query.status as string | undefined;
  const q = String(req.query.q ?? "").trim();
  const topups = await prisma.topupRequest.findMany({
    where: {
      ...(status ? { status: status as "AWAITING" | "FULFILLED" | "EXPIRED" } : {}),
      ...(q
        ? {
            OR: [
              { refCode: { contains: q } },
              { betAccountId: { contains: q } },
            ],
          }
        : {}),
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(
    topups.map((t) => ({
      ...t,
      expectedAmount: t.expectedAmount != null ? toNumber(t.expectedAmount) : null,
      expiresAt: t.expiresAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
    }))
  );
});

apiRouter.post("/topups", async (req, res) => {
  const body = z
    .object({
      userId: z.string(),
      expectedAmount: z.number().positive().optional().nullable(),
      expiresInHours: z.number().positive().default(24),
      refCode: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: body.data.userId } });
  let refCode = body.data.refCode?.toUpperCase() ?? generateRefCode();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.topupRequest.findUnique({ where: { refCode } });
    if (!clash) break;
    refCode = generateRefCode();
  }

  const topup = await prisma.topupRequest.create({
    data: {
      userId: user.id,
      betAccountId: user.betAccountId,
      expectedAmount: body.data.expectedAmount ?? null,
      refCode,
      expiresAt: new Date(Date.now() + body.data.expiresInHours * 3600 * 1000),
    },
    include: { user: true },
  });

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "TOPUP_CREATED",
    entityType: "TopupRequest",
    entityId: topup.id,
    metadata: { refCode },
  });

  res.status(201).json({
    ...topup,
    expectedAmount: topup.expectedAmount != null ? toNumber(topup.expectedAmount) : null,
  });
});

// --- Devices & wallets ---
apiRouter.get("/devices", async (_req, res) => {
  const now = Date.now();
  const devices = await prisma.captureDevice.findMany({
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
    orderBy: { name: "asc" },
  });
  const dtos = devices.map((d) => toDeviceDto(d, now));
  res.json(dtos);
});

apiRouter.get("/wallets", async (_req, res) => {
  const wallets = await prisma.walletNumber.findMany({
    include: { device: { select: { id: true, name: true, lastSeenAt: true } } },
    orderBy: { label: "asc" },
  });
  res.json(wallets);
});

apiRouter.patch("/wallets/:id", requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({
      label: z.string().min(1).max(120),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const existing = await prisma.walletNumber.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Wallet not found" });

  const label = body.data.label.trim();
  if (!label) return res.status(400).json({ error: "Label is required" });
  if (label === existing.label) {
    const unchanged = await prisma.walletNumber.findUniqueOrThrow({
      where: { id: existing.id },
      include: { device: { select: { id: true, name: true, lastSeenAt: true } } },
    });
    return res.json(unchanged);
  }

  const wallet = await prisma.walletNumber.update({
    where: { id: existing.id },
    data: { label },
    include: { device: { select: { id: true, name: true, lastSeenAt: true } } },
  });

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "WALLET_RENAMED",
    entityType: "WalletNumber",
    entityId: wallet.id,
    metadata: {
      previousLabel: existing.label,
      label: wallet.label,
      msisdn: wallet.msisdn,
    },
  });

  res.json(wallet);
});

function provisionPayload(apiKey: string) {
  const provision = {
    v: 1 as const,
    apiBase: config.publicApiBaseUrl,
    apiKey,
  };
  return {
    apiKey,
    provision,
    provisionQrPayload: JSON.stringify(provision),
  };
}

apiRouter.post("/devices", requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      walletNumberId: z.string(),
      siteLabel: z.string().max(120).optional(),
      holderName: z.string().max(120).optional(),
      simMsisdn: z.string().max(32).optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const wallet = await prisma.walletNumber.findUnique({
    where: { id: body.data.walletNumberId },
    include: { device: { select: { id: true } } },
  });
  if (!wallet) return res.status(404).json({ error: "Wallet not found" });
  if (wallet.device) {
    return res.status(409).json({ error: "Wallet already has a capture phone" });
  }

  const apiKey = generateApiKey();
  const device = await prisma.captureDevice.create({
    data: {
      name: body.data.name,
      walletNumberId: body.data.walletNumberId,
      apiKeyHash: hashApiKey(apiKey),
      pendingApiKey: apiKey,
      siteLabel: body.data.siteLabel?.trim() || null,
      holderName: body.data.holderName?.trim() || null,
      simMsisdn: body.data.simMsisdn?.trim() || null,
      notes: body.data.notes?.trim() || null,
    },
  });
  await prisma.walletNumber.update({
    where: { id: body.data.walletNumberId },
    data: { deviceId: device.name },
  });

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_CREATED",
    entityType: "CaptureDevice",
    entityId: device.id,
  });

  res.status(201).json({
    id: device.id,
    name: device.name,
    walletNumberId: device.walletNumberId,
    createdAt: device.createdAt.toISOString(),
    ...provisionPayload(apiKey),
  });
});

apiRouter.patch("/devices/:id", requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1).max(120).optional(),
      siteLabel: z.string().max(120).nullable().optional(),
      holderName: z.string().max(120).nullable().optional(),
      simMsisdn: z.string().max(32).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      walletNumberId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  if (Object.keys(body.data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const existing = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Device not found" });

  const data: Prisma.CaptureDeviceUpdateInput = {};
  if (body.data.name !== undefined) data.name = body.data.name.trim();
  if (body.data.siteLabel !== undefined) data.siteLabel = body.data.siteLabel?.trim() || null;
  if (body.data.holderName !== undefined) data.holderName = body.data.holderName?.trim() || null;
  if (body.data.simMsisdn !== undefined) data.simMsisdn = body.data.simMsisdn?.trim() || null;
  if (body.data.notes !== undefined) data.notes = body.data.notes?.trim() || null;

  if (body.data.walletNumberId && body.data.walletNumberId !== existing.walletNumberId) {
    const target = await prisma.walletNumber.findUnique({
      where: { id: body.data.walletNumberId },
      include: { device: { select: { id: true } } },
    });
    if (!target) return res.status(404).json({ error: "Wallet not found" });
    if (target.device && target.device.id !== existing.id) {
      return res.status(409).json({ error: "Target wallet already has a capture phone" });
    }
    const nextName = (body.data.name ?? existing.name).trim();
    await prisma.$transaction(async (tx) => {
      await tx.walletNumber.update({
        where: { id: existing.walletNumberId },
        data: { deviceId: null },
      });
      await tx.captureDevice.update({
        where: { id: existing.id },
        data: {
          name: nextName,
          siteLabel:
            body.data.siteLabel !== undefined
              ? body.data.siteLabel?.trim() || null
              : undefined,
          holderName:
            body.data.holderName !== undefined
              ? body.data.holderName?.trim() || null
              : undefined,
          simMsisdn:
            body.data.simMsisdn !== undefined
              ? body.data.simMsisdn?.trim() || null
              : undefined,
          notes:
            body.data.notes !== undefined ? body.data.notes?.trim() || null : undefined,
          walletNumberId: target.id,
        },
      });
      await tx.walletNumber.update({
        where: { id: target.id },
        data: { deviceId: nextName },
      });
    });
    await writeAuditLog({
      actorType: "STAFF",
      actorId: req.staff!.staffId,
      action: "DEVICE_REBOUND",
      entityType: "CaptureDevice",
      entityId: existing.id,
      metadata: {
        previousWalletNumberId: existing.walletNumberId,
        walletNumberId: target.id,
      },
    });
  } else {
    const device = await prisma.captureDevice.update({
      where: { id: existing.id },
      data,
    });
    if (body.data.name) {
      await prisma.walletNumber.update({
        where: { id: device.walletNumberId },
        data: { deviceId: device.name },
      });
    }
    if (body.data.name && body.data.name.trim() !== existing.name) {
      await writeAuditLog({
        actorType: "STAFF",
        actorId: req.staff!.staffId,
        action: "DEVICE_RENAMED",
        entityType: "CaptureDevice",
        entityId: device.id,
        metadata: { previousName: existing.name, name: device.name },
      });
    } else if (
      body.data.siteLabel !== undefined ||
      body.data.holderName !== undefined ||
      body.data.simMsisdn !== undefined ||
      body.data.notes !== undefined
    ) {
      await writeAuditLog({
        actorType: "STAFF",
        actorId: req.staff!.staffId,
        action: "DEVICE_NOTES_UPDATED",
        entityType: "CaptureDevice",
        entityId: existing.id,
      });
    }
  }

  const withWallet = await prisma.captureDevice.findUniqueOrThrow({
    where: { id: existing.id },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });
  res.json(toDeviceDto(withWallet));
});

apiRouter.post("/devices/:id/rotate-key", requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Device not found" });

  const apiKey = generateApiKey();
  const device = await prisma.captureDevice.update({
    where: { id: existing.id },
    data: {
      apiKeyHash: hashApiKey(apiKey),
      pendingApiKey: apiKey,
      lastSeenAt: null,
    },
  });

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_KEY_ROTATED",
    entityType: "CaptureDevice",
    entityId: device.id,
  });

  res.json({
    id: device.id,
    name: device.name,
    walletNumberId: device.walletNumberId,
    ...provisionPayload(apiKey),
  });
});

/** Re-show provision QR while pendingApiKey is still set (before first heartbeat). */
apiRouter.get("/devices/:id/provision", requireRole("ADMIN"), async (req, res) => {
  const device = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: "Device not found" });
  if (!device.pendingApiKey) {
    return res.status(410).json({
      error: "Provision key no longer available — rotate key to issue a new QR",
    });
  }
  res.json({
    id: device.id,
    name: device.name,
    walletNumberId: device.walletNumberId,
    ...provisionPayload(device.pendingApiKey),
  });
});

apiRouter.post("/devices/:id/force-sync", requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.captureDevice.findUnique({
    where: { id: req.params.id },
    include: { walletNumber: { select: { msisdn: true, label: true, provider: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Device not found" });
  const device = await prisma.captureDevice.update({
    where: { id: existing.id },
    data: { syncRequestedAt: new Date() },
    include: { walletNumber: { select: { msisdn: true, label: true, provider: true } } },
  });
  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_FORCE_SYNC",
    entityType: "CaptureDevice",
    entityId: device.id,
  });
  res.json(toDeviceDto(device));
});

apiRouter.post("/devices/:id/ping", requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.captureDevice.findUnique({
    where: { id: req.params.id },
    include: { walletNumber: { select: { msisdn: true, label: true, provider: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Device not found" });
  const device = await prisma.captureDevice.update({
    where: { id: existing.id },
    data: { pingRequestedAt: new Date() },
    include: { walletNumber: { select: { msisdn: true, label: true, provider: true } } },
  });
  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_PING",
    entityType: "CaptureDevice",
    entityId: device.id,
  });
  res.json(toDeviceDto(device));
});

apiRouter.post("/devices/:id/wipe", requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.captureDevice.findUnique({
    where: { id: req.params.id },
    include: { walletNumber: { select: { msisdn: true, label: true, provider: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Device not found" });

  // Only flag wipe — key rotates when the phone receives the command on heartbeat
  // so the current sealed key can still authenticate once.
  const device = await prisma.captureDevice.update({
    where: { id: existing.id },
    data: { wipeRequestedAt: new Date() },
    include: { walletNumber: { select: { msisdn: true, label: true, provider: true } } },
  });
  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_WIPE_REQUESTED",
    entityType: "CaptureDevice",
    entityId: device.id,
  });
  res.json(toDeviceDto(device));
});

apiRouter.get("/devices/:id/activity", async (req, res) => {
  const device = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: "Device not found" });
  const take = Math.min(Number(req.query.limit ?? 8), 30);
  const events = await prisma.depositEvent.findMany({
    where: { walletNumberId: device.walletNumberId },
    orderBy: { receivedAt: "desc" },
    take,
  });
  res.json(
    events.map((e) => ({
      id: e.id,
      amount: toNumber(e.amount),
      currency: e.currency,
      matchStatus: e.matchStatus,
      senderName: e.senderName,
      senderMsisdn: e.senderMsisdn,
      reference: e.reference,
      rawMessage: e.rawMessage,
      receivedAt: e.receivedAt.toISOString(),
      source: e.source,
    }))
  );
});

apiRouter.get("/devices/:id/audit", async (req, res) => {
  const device = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: "Device not found" });
  const take = Math.min(Number(req.query.limit ?? 15), 50);
  const logs = await prisma.auditLog.findMany({
    where: { entityType: "CaptureDevice", entityId: device.id },
    orderBy: { createdAt: "desc" },
    take,
  });
  res.json(await attachActorLabels(logs));
});

apiRouter.delete("/devices/:id", requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Device not found" });

  await prisma.$transaction([
    prisma.captureDevice.delete({ where: { id: existing.id } }),
    prisma.walletNumber.update({
      where: { id: existing.walletNumberId },
      data: { deviceId: null },
    }),
  ]);

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_REVOKED",
    entityType: "CaptureDevice",
    entityId: existing.id,
    metadata: {
      name: existing.name,
      deviceName: existing.name,
      walletNumberId: existing.walletNumberId,
    },
  });

  res.json({ ok: true, id: existing.id });
});

// --- Reporting ---
apiRouter.get("/reports/wallet-totals", async (req, res) => {
  const period = (req.query.period === "week" ? "week" : "day") as "day" | "week";
  const since =
    period === "week"
      ? new Date(Date.now() - 7 * 24 * 3600 * 1000)
      : new Date(new Date().setHours(0, 0, 0, 0));

  const wallets = await prisma.walletNumber.findMany();
  const results = [];
  for (const w of wallets) {
    const events = await prisma.depositEvent.findMany({
      where: { walletNumberId: w.id, receivedAt: { gte: since } },
    });
    results.push({
      walletNumberId: w.id,
      msisdn: w.msisdn,
      label: w.label,
      provider: w.provider,
      period,
      totalAmount: events.reduce((s, e) => s + toNumber(e.amount), 0),
      depositCount: events.length,
      matchedCount: events.filter((e) => e.matchStatus === "MATCHED").length,
      unmatchedCount: events.filter((e) => e.matchStatus === "UNMATCHED").length,
      manualCount: events.filter((e) => e.matchStatus === "MANUAL").length,
    });
  }
  res.json(results);
});

/** Close-out: received vs credited vs pending per wallet phone (day or last 7 days). */
apiRouter.get("/reports/daily-closeout", async (req, res) => {
  const dateStr = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const period = req.query.period === "week" ? "week" : "day";
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  if (Number.isNaN(dayEnd.getTime())) {
    return res.status(400).json({ error: "Invalid date (use YYYY-MM-DD)" });
  }
  const dayStart =
    period === "week"
      ? new Date(dayEnd.getTime() - 6 * 24 * 3600 * 1000)
      : new Date(`${dateStr}T00:00:00`);
  dayStart.setHours(0, 0, 0, 0);

  const wallets = await prisma.walletNumber.findMany({ orderBy: { label: "asc" } });
  const walletsOut = [];
  let totals = {
    receivedCount: 0,
    receivedAmount: 0,
    creditedCount: 0,
    creditedAmount: 0,
    pendingCount: 0,
    pendingAmount: 0,
  };

  for (const w of wallets) {
    const events = await prisma.depositEvent.findMany({
      where: { walletNumberId: w.id, receivedAt: { gte: dayStart, lte: dayEnd } },
    });
    const credited = events.filter((e) => e.matchStatus === "MATCHED");
    const pending = events.filter((e) => e.matchStatus !== "MATCHED");
    const row = {
      walletNumberId: w.id,
      msisdn: w.msisdn,
      label: w.label,
      provider: w.provider,
      receivedCount: events.length,
      receivedAmount: events.reduce((s, e) => s + toNumber(e.amount), 0),
      creditedCount: credited.length,
      creditedAmount: credited.reduce((s, e) => s + toNumber(e.amount), 0),
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, e) => s + toNumber(e.amount), 0),
    };
    walletsOut.push(row);
    totals.receivedCount += row.receivedCount;
    totals.receivedAmount += row.receivedAmount;
    totals.creditedCount += row.creditedCount;
    totals.creditedAmount += row.creditedAmount;
    totals.pendingCount += row.pendingCount;
    totals.pendingAmount += row.pendingAmount;
  }

  res.json({
    date: dateStr,
    period,
    from: dayStart.toISOString().slice(0, 10),
    to: dateStr,
    wallets: walletsOut,
    totals,
  });
});

// --- Audit ---
function parseAuditFilters(query: Record<string, unknown>) {
  const actorTypeRaw = String(query.actorType ?? "").toUpperCase();
  const actorType =
    actorTypeRaw === "STAFF" || actorTypeRaw === "DEVICE" || actorTypeRaw === "SYSTEM"
      ? (actorTypeRaw as ActorType)
      : undefined;

  return {
    action: String(query.action ?? "").trim() || undefined,
    actorType,
    actorId: String(query.actorId ?? "").trim() || undefined,
    entityType: String(query.entityType ?? "").trim() || undefined,
    entityId: String(query.entityId ?? "").trim() || undefined,
    from: query.from ? new Date(String(query.from)) : null,
    to: query.to ? new Date(String(query.to)) : null,
    before: query.before ? new Date(String(query.before)) : null,
    q: String(query.q ?? "").trim() || undefined,
  };
}

apiRouter.get("/audit", async (req, res) => {
  const take = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
  const filters = parseAuditFilters(req.query as Record<string, unknown>);
  const where = buildAuditWhere(filters);

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });

  const hasMore = logs.length > take;
  const page = hasMore ? logs.slice(0, take) : logs;
  const items = await attachActorLabels(page);
  const nextBefore = hasMore ? page[page.length - 1]!.createdAt.toISOString() : null;

  res.json({ items, nextBefore });
});

apiRouter.get("/audit/export.csv", async (req, res) => {
  const take = Math.min(Math.max(Number(req.query.limit ?? 5000) || 5000, 1), 10_000);
  const filters = parseAuditFilters(req.query as Record<string, unknown>);
  // Export ignores pagination cursor
  const { before: _before, ...exportFilters } = filters;
  const where = buildAuditWhere(exportFilters);

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
  });
  const items = await attachActorLabels(logs);

  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const header = [
    "createdAt",
    "actorType",
    "actorLabel",
    "actorId",
    "action",
    "entityType",
    "entityId",
    "metadata",
  ].join(",");

  const rows = items.map((l) =>
    [
      esc(l.createdAt),
      esc(l.actorType),
      esc(l.actorLabel),
      esc(l.actorId),
      esc(l.action),
      esc(l.entityType),
      esc(l.entityId),
      esc(l.metadata ? JSON.stringify(l.metadata) : ""),
    ].join(",")
  );

  const day = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ewallet-audit-${day}.csv"`);
  res.send([header, ...rows].join("\n"));
});

// --- Admin: reparse stored raw messages ---
apiRouter.post("/admin/reparse", requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({
      depositEventIds: z.array(z.string()).optional(),
      onlyFailed: z.boolean().optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const where: Prisma.DepositEventWhereInput = body.data.depositEventIds?.length
    ? { id: { in: body.data.depositEventIds } }
    : body.data.onlyFailed
      ? { OR: [{ amount: 0 }, { matchStatus: "UNMATCHED" }] }
      : {};

  const events = await prisma.depositEvent.findMany({ where, take: 500 });
  const results = [];

  for (const event of events) {
    // Do not reparse deposits already marked credited
    if (event.matchStatus === "MATCHED") {
      results.push({ id: event.id, skipped: true, reason: "already_credited" });
      continue;
    }

    const hit = parseSmsWithFallback(event.provider, event.rawMessage);
    if (!hit) {
      results.push({ id: event.id, skipped: true, reason: "parse_failed" });
      continue;
    }

    await prisma.depositEvent.update({
      where: { id: event.id },
      data: {
        provider: hit.provider,
        amount: hit.parsed.amount,
        senderMsisdn: hit.parsed.senderMsisdn,
        senderName: hit.parsed.senderName,
        reference: hit.parsed.reference,
        matchStatus: "UNMATCHED",
        matchedTopupRequestId: null,
      },
    });

    results.push({
      id: event.id,
      skipped: false,
      amount: hit.parsed.amount,
      reference: hit.parsed.reference,
    });
  }

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "ADMIN_REPARSE",
    entityType: "DepositEvent",
    entityId: "batch",
    metadata: { count: results.length },
  });

  res.json({ results });
});
