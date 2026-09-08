import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireDevice } from "../middleware/auth";
import { ingestFromSms } from "../services/ingestion/ingest";
import { writeAuditLog } from "../lib/audit";
import { broadcast } from "../ws/hub";
import { config } from "../config/env";
import { allSenderIds } from "../services/parsers";

export const captureRouter = Router();

captureRouter.use(requireDevice);

captureRouter.post("/heartbeat", async (req, res) => {
  const device = await prisma.captureDevice.update({
    where: { id: req.device!.deviceId },
    data: { lastSeenAt: new Date() },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  const offlineMs = config.deviceOfflineMinutes * 60 * 1000;
  broadcast({
    type: "device.heartbeat",
    payload: {
      id: device.id,
      name: device.name,
      walletNumberId: device.walletNumberId,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      online: true,
      walletNumber: device.walletNumber,
    },
  });

  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    offlineAfterMinutes: config.deviceOfflineMinutes,
    offlineMs,
  });
});

captureRouter.get("/config", async (req, res) => {
  const wallet = await prisma.walletNumber.findUnique({
    where: { id: req.device!.walletNumberId },
  });
  res.json({
    deviceId: req.device!.deviceId,
    deviceName: req.device!.name,
    walletNumber: wallet,
    senderIds: allSenderIds(),
  });
});

const smsBatchSchema = z.object({
  messages: z
    .array(
      z.object({
        rawMessage: z.string().min(1),
        receivedAt: z.string().datetime(),
        /** Stable hash from device (sender+body+timestamp) for idempotency */
        idempotencyKey: z.string().min(8).max(128),
        senderAddress: z.string().optional(),
      })
    )
    .min(1)
    .max(100),
});

captureRouter.post("/sms", async (req, res) => {
  const parsed = smsBatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const wallet = await prisma.walletNumber.findUniqueOrThrow({
    where: { id: req.device!.walletNumberId },
  });

  await prisma.captureDevice.update({
    where: { id: req.device!.deviceId },
    data: { lastSeenAt: new Date() },
  });

  const results = [];
  for (const msg of parsed.data.messages) {
    const result = await ingestFromSms({
      walletNumberId: wallet.id,
      provider: wallet.provider,
      rawMessage: msg.rawMessage,
      receivedAt: new Date(msg.receivedAt),
      captureIdempotencyKey: msg.idempotencyKey,
      deviceId: req.device!.deviceId,
    });
    results.push(result);
  }

  await writeAuditLog({
    actorType: "DEVICE",
    actorId: req.device!.deviceId,
    action: "SMS_BATCH_SYNC",
    entityType: "CaptureDevice",
    entityId: req.device!.deviceId,
    metadata: { count: results.length },
  });

  res.json({ results });
});
