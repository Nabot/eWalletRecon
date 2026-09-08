import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireDevice } from "../middleware/auth";
import { ingestFromSms } from "../services/ingestion/ingest";
import { writeAuditLog } from "../lib/audit";
import { broadcast } from "../ws/hub";
import { config } from "../config/env";
import { allSenderIds } from "../services/parsers";
import { toDeviceDto, maybePostDeviceAlert } from "../services/devices/deviceDto";
import { generateApiKey, hashApiKey } from "../lib/crypto";

const alertThrottle = new Map<string, number>();
function throttledAlert(key: string, text: string, minIntervalMs = 30 * 60_000) {
  const now = Date.now();
  if ((alertThrottle.get(key) ?? 0) + minIntervalMs > now) return;
  alertThrottle.set(key, now);
  void maybePostDeviceAlert(text);
}

export const captureRouter = Router();

captureRouter.use(requireDevice);

const heartbeatBodySchema = z.object({
  appVersionName: z.string().max(40).optional(),
  appVersionCode: z.number().int().nonnegative().optional(),
  pendingSmsCount: z.number().int().nonnegative().max(10_000).optional(),
  lastSyncAt: z.string().datetime().nullable().optional(),
  lastError: z.string().max(500).nullable().optional(),
  lastErrorAt: z.string().datetime().nullable().optional(),
  smsPermissionOk: z.boolean().optional(),
  /** Phone acknowledging a ping request */
  pong: z.boolean().optional(),
}).optional();

captureRouter.post("/heartbeat", async (req, res) => {
  const body = heartbeatBodySchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const telemetry = body.data ?? {};

  const existing = await prisma.captureDevice.findUniqueOrThrow({
    where: { id: req.device!.deviceId },
  });

  const forceSync = existing.syncRequestedAt != null;
  const wipe = existing.wipeRequestedAt != null;
  const requestPong = existing.pingRequestedAt != null && !telemetry.pong;

  const data: Record<string, unknown> = {
    lastSeenAt: new Date(),
  };

  // Claim provision key on normal heartbeats (phone is configured)
  if (!wipe) {
    data.pendingApiKey = null;
  }

  if (telemetry.appVersionName !== undefined) data.appVersionName = telemetry.appVersionName;
  if (telemetry.appVersionCode !== undefined) data.appVersionCode = telemetry.appVersionCode;
  if (telemetry.pendingSmsCount !== undefined) data.pendingSmsCount = telemetry.pendingSmsCount;
  if (telemetry.lastSyncAt !== undefined) {
    data.lastSyncAt = telemetry.lastSyncAt ? new Date(telemetry.lastSyncAt) : null;
  }
  if (telemetry.lastError !== undefined) {
    data.lastError = telemetry.lastError;
    data.lastErrorAt = telemetry.lastError
      ? telemetry.lastErrorAt
        ? new Date(telemetry.lastErrorAt)
        : new Date()
      : null;
  }
  if (telemetry.smsPermissionOk !== undefined) data.smsPermissionOk = telemetry.smsPermissionOk;

  if (telemetry.pong) {
    data.lastPongAt = new Date();
    data.pingRequestedAt = null;
  }

  // Deliver commands once
  if (forceSync) data.syncRequestedAt = null;
  if (wipe) {
    const apiKey = generateApiKey();
    data.wipeRequestedAt = null;
    data.apiKeyHash = hashApiKey(apiKey);
    data.pendingApiKey = apiKey;
  }
  if (requestPong && !telemetry.pong) {
    // keep pingRequestedAt until pong; still tell phone to pong
  }

  const device = await prisma.captureDevice.update({
    where: { id: existing.id },
    data,
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  const dto = toDeviceDto(device);
  broadcast({ type: "device.heartbeat", payload: dto });

  if (dto.queueAlert) {
    throttledAlert(
      `queue:${device.id}`,
      `⚠ Capture phone “${device.name}” queue ${device.pendingSmsCount} (threshold ${config.deviceQueueAlertCount})`
    );
  }
  if (dto.updateRequired) {
    throttledAlert(
      `update:${device.id}`,
      `⚠ Capture phone “${device.name}” needs app update (v${device.appVersionCode ?? "?"} < ${config.minCaptureVersionCode})`
    );
  }

  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    offlineAfterMinutes: config.deviceOfflineMinutes,
    offlineMs: config.deviceOfflineMinutes * 60 * 1000,
    minVersionCode: config.minCaptureVersionCode,
    commands: {
      forceSync,
      wipe,
      pong: requestPong,
    },
  });
});

captureRouter.get("/config", async (req, res) => {
  const wallet = await prisma.walletNumber.findUnique({
    where: { id: req.device!.walletNumberId },
  });
  const device = await prisma.captureDevice.findUnique({
    where: { id: req.device!.deviceId },
    select: { siteLabel: true, notes: true, holderName: true, simMsisdn: true },
  });
  res.json({
    deviceId: req.device!.deviceId,
    deviceName: req.device!.name,
    walletNumber: wallet,
    senderIds: allSenderIds(),
    siteLabel: device?.siteLabel ?? null,
    notes: device?.notes ?? null,
    holderName: device?.holderName ?? null,
    simMsisdn: device?.simMsisdn ?? null,
    minVersionCode: config.minCaptureVersionCode,
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
    data: { lastSeenAt: new Date(), lastSyncAt: new Date(), pendingApiKey: null },
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
