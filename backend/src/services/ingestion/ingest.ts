/**
 * INTEGRATION SEAM — Deposit ingestion
 *
 * All deposit sources (SMS capture, future merchant/webhook APIs, manual entry)
 * normalize into NormalizedDepositInput and call ingestDeposit().
 * The matching engine never cares about the source.
 *
 * Future webhook adapter: implement WebhookDepositSource and POST /api/webhooks/:provider
 * without changing matching.ts.
 */

import type { DepositSource, WalletProvider } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { parseSmsWithFallback } from "../parsers";
import { broadcast } from "../../ws/hub";
import { toNumber } from "../../lib/money";

export interface NormalizedDepositInput {
  walletNumberId: string;
  provider: WalletProvider;
  amount: number;
  currency?: string;
  senderMsisdn?: string | null;
  senderName?: string | null;
  reference?: string | null;
  rawMessage: string;
  receivedAt: Date;
  source: DepositSource;
  externalId?: string | null;
  captureIdempotencyKey?: string | null;
  actorType: "DEVICE" | "SYSTEM" | "STAFF";
  actorId: string;
}

export interface IngestResult {
  depositEventId: string;
  created: boolean;
  matchStatus: string;
  credited: boolean;
}

/**
 * Persist a normalized deposit and run the matching engine.
 * Idempotent on captureIdempotencyKey (SMS) or externalId (webhook).
 */
export async function ingestDeposit(input: NormalizedDepositInput): Promise<IngestResult> {
  if (input.captureIdempotencyKey) {
    const existing = await prisma.depositEvent.findUnique({
      where: { captureIdempotencyKey: input.captureIdempotencyKey },
    });
    if (existing) {
      return {
        depositEventId: existing.id,
        created: false,
        matchStatus: existing.matchStatus,
        credited: existing.matchStatus === "MATCHED",
      };
    }
  }

  if (input.externalId) {
    const existing = await prisma.depositEvent.findFirst({
      where: { externalId: input.externalId, provider: input.provider },
    });
    if (existing) {
      return {
        depositEventId: existing.id,
        created: false,
        matchStatus: existing.matchStatus,
        credited: existing.matchStatus === "MATCHED",
      };
    }
  }

  const event = await prisma.depositEvent.create({
    data: {
      walletNumberId: input.walletNumberId,
      provider: input.provider,
      amount: input.amount,
      currency: input.currency ?? "NAD",
      senderMsisdn: input.senderMsisdn ?? null,
      senderName: input.senderName ?? null,
      reference: input.reference ?? null,
      rawMessage: input.rawMessage,
      receivedAt: input.receivedAt,
      matchStatus: "PENDING",
      source: input.source,
      externalId: input.externalId ?? null,
      captureIdempotencyKey: input.captureIdempotencyKey ?? null,
    },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  await writeAuditLog({
    actorType: input.actorType,
    actorId: input.actorId,
    action: "DEPOSIT_INGESTED",
    entityType: "DepositEvent",
    entityId: event.id,
    metadata: {
      source: input.source,
      amount: input.amount,
      provider: input.provider,
    },
  });

  // No auto-match to users — queue for staff to credit betting accounts manually.
  const queued = await prisma.depositEvent.update({
    where: { id: event.id },
    data: { matchStatus: "UNMATCHED" },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  broadcast({
    type: "deposit.created",
    payload: serializeDeposit(queued),
  });

  return {
    depositEventId: event.id,
    created: true,
    matchStatus: "UNMATCHED",
    credited: false,
  };
}

/**
 * SMS path: parse raw message then ingest.
 * Falls back across provider parsers if the wallet's primary parser does not match.
 */
export async function ingestFromSms(params: {
  walletNumberId: string;
  provider: WalletProvider;
  rawMessage: string;
  receivedAt: Date;
  captureIdempotencyKey?: string;
  deviceId: string;
}): Promise<IngestResult> {
  const hit = parseSmsWithFallback(params.provider, params.rawMessage);
  if (!hit) {
    // Always store raw so staff can reparse after a parser update.
    return ingestDeposit({
      walletNumberId: params.walletNumberId,
      provider: params.provider,
      amount: 0,
      senderMsisdn: null,
      senderName: null,
      reference: null,
      rawMessage: params.rawMessage,
      receivedAt: params.receivedAt,
      source: "SMS",
      captureIdempotencyKey: params.captureIdempotencyKey,
      actorType: "DEVICE",
      actorId: params.deviceId,
    });
  }

  return ingestDeposit({
    walletNumberId: params.walletNumberId,
    provider: hit.provider,
    amount: hit.parsed.amount,
    senderMsisdn: hit.parsed.senderMsisdn,
    senderName: hit.parsed.senderName,
    reference: hit.parsed.reference,
    rawMessage: params.rawMessage,
    receivedAt: hit.parsed.timestamp ?? params.receivedAt,
    source: "SMS",
    captureIdempotencyKey: params.captureIdempotencyKey,
    actorType: "DEVICE",
    actorId: params.deviceId,
  });
}

/**
 * FUTURE WEBHOOK SEAM — implement provider-specific verification here, then:
 *   ingestDeposit({ ..., source: "WEBHOOK", externalId: ... })
 */
export async function ingestFromWebhook(_params: {
  provider: WalletProvider;
  payload: unknown;
}): Promise<never> {
  throw new Error(
    "Webhook deposit source not yet implemented. Add provider merchant API adapter here; call ingestDeposit() with source=WEBHOOK."
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeDeposit(event: any) {
  return {
    id: event.id,
    walletNumberId: event.walletNumberId,
    provider: event.provider,
    amount: toNumber(event.amount),
    currency: event.currency,
    senderMsisdn: event.senderMsisdn,
    senderName: event.senderName ?? null,
    reference: event.reference,
    rawMessage: event.rawMessage,
    receivedAt: event.receivedAt.toISOString(),
    matchStatus: event.matchStatus,
    matchedTopupRequestId: event.matchedTopupRequestId,
    creditBetAccountId: event.creditBetAccountId ?? null,
    creditNote: event.creditNote ?? null,
    creditedAt: event.creditedAt ? event.creditedAt.toISOString() : null,
    creditedByStaffId: event.creditedByStaffId ?? null,
    createdAt: event.createdAt.toISOString(),
    walletNumber: event.walletNumber,
  };
}
