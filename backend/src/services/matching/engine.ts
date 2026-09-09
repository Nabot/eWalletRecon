/**
 * Matching engine — priority:
 * 1. Reference code → auto-credit
 * 2. Sender MSISDN + amount → auto-credit
 * 3. Amount + time heuristic (exactly one candidate) → MANUAL (no auto-credit)
 * 4. Else → UNMATCHED
 *
 * Credits are idempotent: unique depositEventId on CreditLedger.
 */

import {
  MatchStatus,
  Prisma,
  TopupStatus,
  ActorType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { amountsEqual, toNumber } from "../../lib/money";
import { config } from "../../config/env";
import { resolveMatchReference } from "../parsers/types";
import { broadcast } from "../../ws/hub";

export interface MatchOutcome {
  status: MatchStatus;
  topupRequestId: string | null;
  reason: string;
  credited: boolean;
}

export async function matchDepositEvent(
  depositEventId: string,
  actor: { actorType: ActorType; actorId: string } = {
    actorType: "SYSTEM",
    actorId: "matching-engine",
  }
): Promise<MatchOutcome> {
  const outcome = await prisma.$transaction(async (tx): Promise<MatchOutcome> => {
    const event = await tx.depositEvent.findUnique({
      where: { id: depositEventId },
    });
    if (!event) throw new Error(`DepositEvent ${depositEventId} not found`);

    // Already matched + credited → idempotent no-op
    const existingCredit = await tx.creditLedger.findUnique({
      where: { depositEventId },
    });
    if (existingCredit) {
      return {
        status: MatchStatus.MATCHED,
        topupRequestId: event.matchedTopupRequestId,
        reason: "Already credited (idempotent)",
        credited: true,
      };
    }

    if (event.matchStatus === "MATCHED" && event.matchedTopupRequestId) {
      return {
        status: MatchStatus.MATCHED,
        topupRequestId: event.matchedTopupRequestId,
        reason: "Already matched",
        credited: false,
      };
    }

    // Skip zero-amount parse failures
    if (toNumber(event.amount) <= 0) {
      await tx.depositEvent.update({
        where: { id: depositEventId },
        data: { matchStatus: "UNMATCHED" },
      });
      return {
        status: MatchStatus.UNMATCHED,
        topupRequestId: null,
        reason: "Amount missing or zero — needs reparse",
        credited: false,
      };
    }

    const now = new Date();
    const refFromFields = resolveMatchReference(event.reference, event.rawMessage);

    // --- 1. Reference code (BET#### or EasyWallet REF:…) ---
    if (refFromFields) {
      const byRef = await tx.topupRequest.findFirst({
        where: {
          refCode: { equals: refFromFields },
          status: TopupStatus.AWAITING,
          expiresAt: { gt: now },
        },
        include: { user: true },
      });
      if (byRef) {
        return fulfillMatch(tx, event, byRef, "REF_CODE", actor);
      }
    }

    // --- 2. Sender MSISDN + amount ---
    if (event.senderMsisdn) {
      const candidates = await tx.topupRequest.findMany({
        where: {
          status: TopupStatus.AWAITING,
          expiresAt: { gt: now },
          expectedAmount: { not: null },
          user: { registeredMsisdn: event.senderMsisdn },
        },
        include: { user: true },
      });
      const amountMatch = candidates.filter((c) =>
        c.expectedAmount != null && amountsEqual(c.expectedAmount, event.amount)
      );
      if (amountMatch.length === 1) {
        return fulfillMatch(tx, event, amountMatch[0], "MSISDN_AMOUNT", actor);
      }
    }

    // --- 3. Amount + time heuristic → MANUAL ---
    const windowMs = config.matchTimeWindowMinutes * 60 * 1000;
    const windowStart = new Date(event.receivedAt.getTime() - windowMs);
    const windowEnd = new Date(event.receivedAt.getTime() + windowMs);

    const amountCandidates = await tx.topupRequest.findMany({
      where: {
        status: TopupStatus.AWAITING,
        expiresAt: { gt: now },
        expectedAmount: { not: null },
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      include: { user: true },
    });
    const exactAmount = amountCandidates.filter(
      (c) => c.expectedAmount != null && amountsEqual(c.expectedAmount, event.amount)
    );

    if (exactAmount.length === 1) {
      await tx.depositEvent.update({
        where: { id: event.id },
        data: {
          matchStatus: "MANUAL",
          matchedTopupRequestId: exactAmount[0].id,
        },
      });
      await writeAuditLog({
        tx,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "DEPOSIT_FLAGGED_MANUAL",
        entityType: "DepositEvent",
        entityId: event.id,
        metadata: {
          reason: "AMOUNT_time_heuristic",
          topupRequestId: exactAmount[0].id,
          windowMinutes: config.matchTimeWindowMinutes,
        },
      });
      return {
        status: MatchStatus.MANUAL,
        topupRequestId: exactAmount[0].id,
        reason: "Single amount match in time window — needs staff confirmation",
        credited: false,
      };
    }

    // --- 4. Unmatched ---
    await tx.depositEvent.update({
      where: { id: event.id },
      data: { matchStatus: "UNMATCHED", matchedTopupRequestId: null },
    });
    await writeAuditLog({
      tx,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "DEPOSIT_UNMATCHED",
      entityType: "DepositEvent",
      entityId: event.id,
      metadata: { amountCandidates: exactAmount.length },
    });
    return {
      status: MatchStatus.UNMATCHED,
      topupRequestId: null,
      reason: "No matching top-up request",
      credited: false,
    };
  });

  const updated = await prisma.depositEvent.findUnique({
    where: { id: depositEventId },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });
  if (updated) {
    broadcast({
      type: "deposit.updated",
      payload: {
        id: updated.id,
        walletNumberId: updated.walletNumberId,
        provider: updated.provider,
        amount: toNumber(updated.amount),
        currency: updated.currency,
senderMsisdn: updated.senderMsisdn,
          senderName: updated.senderName,
          reference: updated.reference,
        rawMessage: updated.rawMessage,
        receivedAt: updated.receivedAt.toISOString(),
        matchStatus: updated.matchStatus,
        matchedTopupRequestId: updated.matchedTopupRequestId,
        creditBetAccountId: updated.creditBetAccountId,
        creditNote: updated.creditNote,
        creditedAt: updated.creditedAt?.toISOString() ?? null,
        creditedByStaffId: updated.creditedByStaffId,
        creditProvider: updated.creditProvider ?? null,
        pstbetOurReference: updated.pstbetOurReference ?? null,
        pstbetTheirReference: updated.pstbetTheirReference ?? null,
        creditError: updated.creditError ?? null,
        channel: updated.channel ?? "WALLET",
        createdAt: updated.createdAt.toISOString(),
        walletNumber: updated.walletNumber,
      },
    });
  }
  return outcome;
}

async function fulfillMatch(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    amount: Prisma.Decimal;
  },
  topup: {
    id: string;
    userId: string;
    betAccountId: string;
    refCode: string;
  },
  matchType: string,
  actor: { actorType: ActorType; actorId: string }
): Promise<MatchOutcome> {
  // Idempotent credit
  const existing = await tx.creditLedger.findUnique({
    where: { depositEventId: event.id },
  });
  if (existing) {
    return {
      status: MatchStatus.MATCHED,
      topupRequestId: topup.id,
      reason: `Already credited via ${matchType}`,
      credited: true,
    };
  }

  await tx.topupRequest.update({
    where: { id: topup.id },
    data: { status: TopupStatus.FULFILLED },
  });

  await tx.depositEvent.update({
    where: { id: event.id },
    data: {
      matchStatus: "MATCHED",
      matchedTopupRequestId: topup.id,
    },
  });

  await tx.creditLedger.create({
    data: {
      userId: topup.userId,
      depositEventId: event.id,
      amount: event.amount,
    },
  });

  await writeAuditLog({
    tx,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "DEPOSIT_MATCHED_CREDITED",
    entityType: "DepositEvent",
    entityId: event.id,
    metadata: {
      matchType,
      topupRequestId: topup.id,
      userId: topup.userId,
      betAccountId: topup.betAccountId,
      refCode: topup.refCode,
      amount: toNumber(event.amount),
    },
  });

  return {
    status: MatchStatus.MATCHED,
    topupRequestId: topup.id,
    reason: `Matched by ${matchType}`,
    credited: true,
  };
}

/**
 * Staff confirms MANUAL or assigns UNMATCHED to a top-up / user and credits.
 */
export async function manualResolve(params: {
  depositEventId: string;
  topupRequestId: string;
  staffId: string;
}): Promise<MatchOutcome> {
  const outcome = await prisma.$transaction(async (tx): Promise<MatchOutcome> => {
    const event = await tx.depositEvent.findUniqueOrThrow({
      where: { id: params.depositEventId },
    });
    const existingCredit = await tx.creditLedger.findUnique({
      where: { depositEventId: params.depositEventId },
    });
    if (existingCredit) {
      return {
        status: MatchStatus.MATCHED,
        topupRequestId: event.matchedTopupRequestId,
        reason: "Already credited (idempotent)",
        credited: true,
      };
    }

    const topup = await tx.topupRequest.findUniqueOrThrow({
      where: { id: params.topupRequestId },
      include: { user: true },
    });

    if (topup.status === TopupStatus.FULFILLED) {
      throw new Error("Top-up request already fulfilled");
    }

    return fulfillMatch(
      tx,
      event,
      topup,
      "MANUAL_RESOLVE",
      { actorType: "STAFF", actorId: params.staffId }
    );
  });

  const updated = await prisma.depositEvent.findUnique({
    where: { id: params.depositEventId },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });
  if (updated) {
    broadcast({
      type: "deposit.updated",
      payload: {
        id: updated.id,
        walletNumberId: updated.walletNumberId,
        provider: updated.provider,
        amount: toNumber(updated.amount),
        currency: updated.currency,
senderMsisdn: updated.senderMsisdn,
          senderName: updated.senderName,
          reference: updated.reference,
        rawMessage: updated.rawMessage,
        receivedAt: updated.receivedAt.toISOString(),
        matchStatus: updated.matchStatus,
        matchedTopupRequestId: updated.matchedTopupRequestId,
        creditBetAccountId: updated.creditBetAccountId,
        creditNote: updated.creditNote,
        creditedAt: updated.creditedAt?.toISOString() ?? null,
        creditedByStaffId: updated.creditedByStaffId,
        creditProvider: updated.creditProvider ?? null,
        pstbetOurReference: updated.pstbetOurReference ?? null,
        pstbetTheirReference: updated.pstbetTheirReference ?? null,
        creditError: updated.creditError ?? null,
        channel: updated.channel ?? "WALLET",
        createdAt: updated.createdAt.toISOString(),
        walletNumber: updated.walletNumber,
      },
    });
  }
  return outcome;
}
