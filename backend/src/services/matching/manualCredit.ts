/**
 * Manual credit marking — no auto-match to users / top-up requests.
 */

import { MatchStatus, ActorType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { toNumber } from "../../lib/money";
import { broadcast } from "../../ws/hub";

export interface MarkCreditedOutcome {
  status: MatchStatus;
  credited: boolean;
  reason: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDto(updated: any) {
  return {
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
    creditBetAccountId: updated.creditBetAccountId ?? null,
    creditNote: updated.creditNote ?? null,
    creditedAt: updated.creditedAt ? updated.creditedAt.toISOString() : null,
    creditedByStaffId: updated.creditedByStaffId ?? null,
    createdAt: updated.createdAt.toISOString(),
    walletNumber: updated.walletNumber,
  };
}

export async function markDepositCredited(params: {
  depositEventId: string;
  staffId: string;
  betAccountId: string;
  note?: string | null;
}): Promise<MarkCreditedOutcome> {
  const betAccountId = params.betAccountId.trim();
  if (!betAccountId) {
    throw new Error("Bet account ID is required");
  }

  const event = await prisma.depositEvent.findUniqueOrThrow({
    where: { id: params.depositEventId },
  });

  if (event.matchStatus === "MATCHED") {
    return {
      status: MatchStatus.MATCHED,
      credited: true,
      reason: "Already marked credited",
    };
  }

  const updated = await prisma.depositEvent.update({
    where: { id: event.id },
    data: {
      matchStatus: MatchStatus.MATCHED,
      matchedTopupRequestId: null,
      creditBetAccountId: betAccountId,
      creditNote: params.note?.trim() || null,
      creditedAt: new Date(),
      creditedByStaffId: params.staffId,
    },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  await writeAuditLog({
    actorType: ActorType.STAFF,
    actorId: params.staffId,
    action: "DEPOSIT_MARKED_CREDITED",
    entityType: "DepositEvent",
    entityId: event.id,
    metadata: {
      amount: toNumber(event.amount),
      provider: event.provider,
      reference: event.reference,
      senderMsisdn: event.senderMsisdn,
      senderName: event.senderName,
      betAccountId,
      note: params.note?.trim() || null,
      mode: "manual",
    },
  });

  broadcast({ type: "deposit.updated", payload: toDto(updated) });

  return {
    status: MatchStatus.MATCHED,
    credited: true,
    reason: "Marked credited manually",
  };
}

export async function uncreditDeposit(params: {
  depositEventId: string;
  staffId: string;
  reason?: string | null;
}): Promise<MarkCreditedOutcome> {
  const event = await prisma.depositEvent.findUniqueOrThrow({
    where: { id: params.depositEventId },
  });

  if (event.matchStatus !== "MATCHED") {
    return {
      status: event.matchStatus,
      credited: false,
      reason: "Deposit is not credited",
    };
  }

  const updated = await prisma.depositEvent.update({
    where: { id: event.id },
    data: {
      matchStatus: MatchStatus.UNMATCHED,
      creditBetAccountId: null,
      creditNote: null,
      creditedAt: null,
      creditedByStaffId: null,
      matchedTopupRequestId: null,
    },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  await writeAuditLog({
    actorType: ActorType.STAFF,
    actorId: params.staffId,
    action: "DEPOSIT_UNCREDITED",
    entityType: "DepositEvent",
    entityId: event.id,
    metadata: {
      amount: toNumber(event.amount),
      previousBetAccountId: event.creditBetAccountId,
      previousNote: event.creditNote,
      reason: params.reason?.trim() || null,
    },
  });

  broadcast({ type: "deposit.updated", payload: toDto(updated) });

  return {
    status: MatchStatus.UNMATCHED,
    credited: false,
    reason: "Credit undone",
  };
}
