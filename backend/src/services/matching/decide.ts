/**
 * Pure matching decision helpers — unit-testable without DB.
 * The full engine in engine.ts uses these rules against Prisma.
 */

import { resolveMatchReference } from "../parsers/types";

export type MatchDecision =
  | { kind: "AUTO"; matchType: "REF_CODE" | "MSISDN_AMOUNT"; topupId: string }
  | { kind: "MANUAL"; topupId: string; reason: string }
  | { kind: "UNMATCHED"; reason: string };

export interface DepositSnapshot {
  amount: number;
  senderMsisdn: string | null;
  reference: string | null;
  rawMessage: string;
  receivedAt: Date;
}

export interface TopupSnapshot {
  id: string;
  refCode: string;
  expectedAmount: number | null;
  userMsisdn: string;
  status: "AWAITING" | "FULFILLED" | "EXPIRED";
  expiresAt: Date;
  createdAt: Date;
}

export function decideMatch(
  deposit: DepositSnapshot,
  awaiting: TopupSnapshot[],
  windowMinutes: number,
  now: Date = new Date()
): MatchDecision {
  if (deposit.amount <= 0) {
    return { kind: "UNMATCHED", reason: "Amount missing or zero" };
  }

  const open = awaiting.filter(
    (t) => t.status === "AWAITING" && t.expiresAt > now
  );

  // 1. Exact reference match — BET#### or EasyWallet REF:20260820-71391772 etc.
  const ref = resolveMatchReference(deposit.reference, deposit.rawMessage);
  if (ref) {
    const hit = open.find((t) => t.refCode.toUpperCase() === ref.toUpperCase());
    if (hit) return { kind: "AUTO", matchType: "REF_CODE", topupId: hit.id };
  }

  if (deposit.senderMsisdn) {
    const hits = open.filter(
      (t) =>
        t.userMsisdn === deposit.senderMsisdn &&
        t.expectedAmount != null &&
        Math.abs(t.expectedAmount - deposit.amount) < 0.001
    );
    if (hits.length === 1) {
      return { kind: "AUTO", matchType: "MSISDN_AMOUNT", topupId: hits[0].id };
    }
  }

  const windowMs = windowMinutes * 60 * 1000;
  const start = deposit.receivedAt.getTime() - windowMs;
  const end = deposit.receivedAt.getTime() + windowMs;
  const amountHits = open.filter(
    (t) =>
      t.expectedAmount != null &&
      Math.abs(t.expectedAmount - deposit.amount) < 0.001 &&
      t.createdAt.getTime() >= start &&
      t.createdAt.getTime() <= end
  );

  if (amountHits.length === 1) {
    return {
      kind: "MANUAL",
      topupId: amountHits[0].id,
      reason: "Single amount match in time window",
    };
  }

  return { kind: "UNMATCHED", reason: "No matching top-up request" };
}
