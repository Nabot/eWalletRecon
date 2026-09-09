/**
 * Assisted PstBet credit — staff looks up account, confirms, then top-up via API.
 */

import { MatchStatus, ActorType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { toNumber } from "../../lib/money";
import { broadcast } from "../../ws/hub";
import { config, isPstBetConfigured } from "../../config/env";
import {
  PstBetApiError,
  checkPstBetAccount,
  topUpPstBetAccount,
  toPstBetMobile,
  type PstBetPunter,
} from "./client";

export interface PstBetLookupResult {
  depositId: string;
  amount: number;
  currency: string;
  senderMsisdn: string | null;
  mobile: string;
  punter: PstBetPunter;
  amountInRange: boolean;
  minAmount: number;
  maxAmount: number;
}

export interface PstBetCreditOutcome {
  status: MatchStatus;
  credited: boolean;
  reason: string;
  ourReference: string | null;
  theirReference: string | null;
  betAccountId: string;
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
    creditProvider: updated.creditProvider ?? null,
    pstbetOurReference: updated.pstbetOurReference ?? null,
    pstbetTheirReference: updated.pstbetTheirReference ?? null,
    creditError: updated.creditError ?? null,
    channel: updated.channel ?? "WALLET",
    createdAt: updated.createdAt.toISOString(),
    walletNumber: updated.walletNumber,
  };
}

function resolveMobile(depositSender: string | null, override?: string | null): string {
  const raw = override?.trim() || depositSender;
  const mobile = toPstBetMobile(raw);
  if (!mobile) {
    throw new PstBetApiError(
      "No valid sender mobile on this deposit — enter the betting account mobile",
      "NOT_FOUND"
    );
  }
  return mobile;
}

export async function lookupPstBetForDeposit(params: {
  depositEventId: string;
  mobileOverride?: string | null;
}): Promise<PstBetLookupResult> {
  if (!isPstBetConfigured()) {
    throw new PstBetApiError(
      "PstBet is not configured (set PSTBET_USERNAME and PSTBET_PASSWORD)",
      "CONFIG"
    );
  }

  const event = await prisma.depositEvent.findUniqueOrThrow({
    where: { id: params.depositEventId },
  });

  if (event.matchStatus === "MATCHED") {
    throw new PstBetApiError("Deposit is already credited", "REJECTED");
  }

  const amount = toNumber(event.amount);
  const mobile = resolveMobile(event.senderMsisdn, params.mobileOverride);
  const punter = await checkPstBetAccount(mobile);
  const { minAmount, maxAmount } = config.pstbet;

  return {
    depositId: event.id,
    amount,
    currency: event.currency,
    senderMsisdn: event.senderMsisdn,
    mobile,
    punter,
    amountInRange: amount >= minAmount && amount <= maxAmount,
    minAmount,
    maxAmount,
  };
}

export async function creditDepositViaPstBet(params: {
  depositEventId: string;
  staffId: string;
  userId: number;
  userName: string;
  mobile: string;
  note?: string | null;
}): Promise<PstBetCreditOutcome> {
  if (!isPstBetConfigured()) {
    throw new PstBetApiError(
      "PstBet is not configured (set PSTBET_USERNAME and PSTBET_PASSWORD)",
      "CONFIG"
    );
  }

  const event = await prisma.depositEvent.findUniqueOrThrow({
    where: { id: params.depositEventId },
  });

  if (event.matchStatus === "MATCHED") {
    if (event.creditProvider === "PSTBET" && event.pstbetOurReference) {
      return {
        status: MatchStatus.MATCHED,
        credited: true,
        reason: "Already credited via PstBet",
        ourReference: event.pstbetOurReference,
        theirReference: event.pstbetTheirReference,
        betAccountId: event.creditBetAccountId ?? params.userName,
      };
    }
    throw new PstBetApiError("Deposit is already credited", "REJECTED");
  }

  const amount = toNumber(event.amount);
  const mobile = resolveMobile(null, params.mobile);

  // Re-verify account before payment (API requirement + fraud guard)
  const punter = await checkPstBetAccount(mobile);
  if (punter.punterId !== params.userId || punter.userName !== params.userName) {
    throw new PstBetApiError(
      "Account details changed since lookup — please look up again",
      "REJECTED"
    );
  }

  let payment;
  try {
    payment = await topUpPstBetAccount({
      userId: punter.punterId,
      userName: punter.userName,
      mobile,
      amount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "PstBet top-up failed";
    await prisma.depositEvent.update({
      where: { id: event.id },
      data: { creditError: message },
    });
    await writeAuditLog({
      actorType: ActorType.STAFF,
      actorId: params.staffId,
      action: "DEPOSIT_PSTBET_CREDIT_FAILED",
      entityType: "DepositEvent",
      entityId: event.id,
      metadata: {
        amount,
        mobile,
        userId: punter.punterId,
        userName: punter.userName,
        error: message,
      },
    });
    throw e;
  }

  const updated = await prisma.depositEvent.update({
    where: { id: event.id },
    data: {
      matchStatus: MatchStatus.MATCHED,
      matchedTopupRequestId: null,
      creditBetAccountId: punter.userName,
      creditNote: params.note?.trim() || null,
      creditedAt: new Date(),
      creditedByStaffId: params.staffId,
      creditProvider: "PSTBET",
      pstbetOurReference: payment.ourReference,
      pstbetTheirReference: payment.theirReference,
      creditError: null,
    },
    include: {
      walletNumber: { select: { msisdn: true, label: true, provider: true } },
    },
  });

  await writeAuditLog({
    actorType: ActorType.STAFF,
    actorId: params.staffId,
    action: "DEPOSIT_PSTBET_CREDITED",
    entityType: "DepositEvent",
    entityId: event.id,
    metadata: {
      amount,
      provider: event.provider,
      reference: event.reference,
      senderMsisdn: event.senderMsisdn,
      mobile,
      userId: punter.punterId,
      userName: punter.userName,
      ourReference: payment.ourReference,
      theirReference: payment.theirReference,
      note: params.note?.trim() || null,
      mode: "pstbet",
    },
  });

  broadcast({ type: "deposit.updated", payload: toDto(updated) });

  return {
    status: MatchStatus.MATCHED,
    credited: true,
    reason: "Credited via PstBet",
    ourReference: payment.ourReference,
    theirReference: payment.theirReference,
    betAccountId: punter.userName,
  };
}
