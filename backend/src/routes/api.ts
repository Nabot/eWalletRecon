import { Router } from "express";
import { z } from "zod";
import { MatchStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireStaff, requireRole } from "../middleware/auth";
import { markDepositCredited, uncreditDeposit } from "../services/matching/manualCredit";
import { parseSmsWithFallback } from "../services/parsers";
import { writeAuditLog } from "../lib/audit";
import { toNumber } from "../lib/money";
import { config } from "../config/env";
import { generateApiKey, generateRefCode, hashApiKey } from "../lib/crypto";

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

  if (provider && ["PAYPULSE", "EASYWALLET", "PAY2CELL", "EWALLET"].includes(provider)) {
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

  const where: Prisma.DepositEventWhereInput = {
    receivedAt: { gte: from, lte: to },
  };
  if (walletNumberId) where.walletNumberId = walletNumberId;

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

apiRouter.get("/exceptions", async (_req, res) => {
  const deposits = await prisma.depositEvent.findMany({
    where: pendingWhere(),
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
  const offlineMs = config.deviceOfflineMinutes * 60 * 1000;
  const now = Date.now();
  const devices = await prisma.captureDevice.findMany({
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json(
    devices.map((d) => ({
      id: d.id,
      name: d.name,
      walletNumberId: d.walletNumberId,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      online: d.lastSeenAt != null && now - d.lastSeenAt.getTime() < offlineMs,
      walletNumber: d.walletNumber,
    }))
  );
});

apiRouter.get("/wallets", async (_req, res) => {
  const wallets = await prisma.walletNumber.findMany({
    include: { device: { select: { id: true, name: true, lastSeenAt: true } } },
    orderBy: { label: "asc" },
  });
  res.json(wallets);
});

apiRouter.post("/devices", requireRole("ADMIN"), async (req, res) => {
  const body = z
    .object({ name: z.string().min(1), walletNumberId: z.string() })
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

  const provision = {
    v: 1 as const,
    apiBase: config.publicApiBaseUrl,
    apiKey,
  };

  // apiKey + provision shown once — never stored in plaintext
  res.status(201).json({
    id: device.id,
    name: device.name,
    walletNumberId: device.walletNumberId,
    createdAt: device.createdAt.toISOString(),
    apiKey,
    provision,
    provisionQrPayload: JSON.stringify(provision),
  });
});

apiRouter.patch("/devices/:id", requireRole("ADMIN"), async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(120) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const existing = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Device not found" });

  const name = body.data.name.trim();
  const device = await prisma.captureDevice.update({
    where: { id: existing.id },
    data: { name },
  });
  await prisma.walletNumber.update({
    where: { id: device.walletNumberId },
    data: { deviceId: name },
  });

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_RENAMED",
    entityType: "CaptureDevice",
    entityId: device.id,
    metadata: { previousName: existing.name, name },
  });

  const offlineMs = config.deviceOfflineMinutes * 60 * 1000;
  const now = Date.now();
  const withWallet = await prisma.captureDevice.findUniqueOrThrow({
    where: { id: device.id },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });
  res.json({
    id: withWallet.id,
    name: withWallet.name,
    walletNumberId: withWallet.walletNumberId,
    lastSeenAt: withWallet.lastSeenAt?.toISOString() ?? null,
    online: withWallet.lastSeenAt != null && now - withWallet.lastSeenAt.getTime() < offlineMs,
    walletNumber: withWallet.walletNumber,
  });
});

apiRouter.post("/devices/:id/rotate-key", requireRole("ADMIN"), async (req, res) => {
  const existing = await prisma.captureDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Device not found" });

  const apiKey = generateApiKey();
  const device = await prisma.captureDevice.update({
    where: { id: existing.id },
    data: { apiKeyHash: hashApiKey(apiKey), lastSeenAt: null },
  });

  await writeAuditLog({
    actorType: "STAFF",
    actorId: req.staff!.staffId,
    action: "DEVICE_KEY_ROTATED",
    entityType: "CaptureDevice",
    entityId: device.id,
  });

  const provision = {
    v: 1 as const,
    apiBase: config.publicApiBaseUrl,
    apiKey,
  };

  res.json({
    id: device.id,
    name: device.name,
    walletNumberId: device.walletNumberId,
    apiKey,
    provision,
    provisionQrPayload: JSON.stringify(provision),
  });
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
    metadata: { name: existing.name, walletNumberId: existing.walletNumberId },
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
apiRouter.get("/audit", async (req, res) => {
  const take = Math.min(Number(req.query.limit ?? 100), 500);
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });

  const staffIds = [...new Set(logs.filter((l) => l.actorType === "STAFF").map((l) => l.actorId))];
  const deviceIds = [...new Set(logs.filter((l) => l.actorType === "DEVICE").map((l) => l.actorId))];

  const [staffRows, deviceRows] = await Promise.all([
    staffIds.length
      ? prisma.staffUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, email: true } })
      : Promise.resolve([]),
    deviceIds.length
      ? prisma.captureDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const staffMap = new Map(staffRows.map((s) => [s.id, s.email]));
  const deviceMap = new Map(deviceRows.map((d) => [d.id, d.name]));

  res.json(
    logs.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      actorLabel:
        l.actorType === "STAFF"
          ? staffMap.get(l.actorId) ?? "Staff"
          : l.actorType === "DEVICE"
            ? deviceMap.get(l.actorId) ?? "Device"
            : l.actorType === "SYSTEM"
              ? "System"
              : null,
    }))
  );
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
