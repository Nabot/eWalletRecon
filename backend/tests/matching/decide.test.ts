import { describe, it, expect } from "vitest";
import { decideMatch, type DepositSnapshot, type TopupSnapshot } from "../../src/services/matching/decide";

describe("decideMatch", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const receivedAt = new Date("2026-09-08T12:00:00Z");

  const baseTopup = (over: Partial<TopupSnapshot> & { id: string }): TopupSnapshot => ({
    refCode: "BET9999",
    expectedAmount: 100,
    userMsisdn: "264811111111",
    status: "AWAITING",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    ...over,
  });

  it("matches by reference code (priority 1)", () => {
    const deposit: DepositSnapshot = {
      amount: 100,
      senderMsisdn: null,
      reference: "BET4821",
      rawMessage: "PayPulse: N$100.00 Ref: BET4821",
      receivedAt,
    };
    const topups = [
      baseTopup({ id: "t1", refCode: "BET4821", expectedAmount: 999 }),
      baseTopup({ id: "t2", refCode: "BET4822", expectedAmount: 100, userMsisdn: "264811111111" }),
    ];
    const d = decideMatch(deposit, topups, 15, now);
    expect(d).toEqual({ kind: "AUTO", matchType: "REF_CODE", topupId: "t1" });
  });

  it("extracts ref code from raw message when reference field empty", () => {
    const deposit: DepositSnapshot = {
      amount: 50,
      senderMsisdn: null,
      reference: null,
      rawMessage: "Deposit NAD 50.00 reference BET4823 thanks",
      receivedAt,
    };
    const topups = [baseTopup({ id: "t3", refCode: "BET4823", expectedAmount: 50 })];
    expect(decideMatch(deposit, topups, 15, now).kind).toBe("AUTO");
  });

  it("matches by sender MSISDN + amount (priority 2)", () => {
    const deposit: DepositSnapshot = {
      amount: 250,
      senderMsisdn: "264812222222",
      reference: null,
      rawMessage: "EasyWallet: N$250.00 from 0812222222",
      receivedAt,
    };
    const topups = [
      baseTopup({
        id: "t4",
        refCode: "BET1111",
        expectedAmount: 250,
        userMsisdn: "264812222222",
      }),
    ];
    expect(decideMatch(deposit, topups, 15, now)).toEqual({
      kind: "AUTO",
      matchType: "MSISDN_AMOUNT",
      topupId: "t4",
    });
  });

  it("flags MANUAL when exactly one amount match in time window (priority 3)", () => {
    const deposit: DepositSnapshot = {
      amount: 75,
      senderMsisdn: null,
      reference: null,
      rawMessage: "N$75.00 received",
      receivedAt,
    };
    const topups = [
      baseTopup({
        id: "t5",
        refCode: "BET2222",
        expectedAmount: 75,
        userMsisdn: "264819999999",
        createdAt: new Date("2026-09-08T11:55:00Z"),
      }),
    ];
    const d = decideMatch(deposit, topups, 15, now);
    expect(d).toEqual({
      kind: "MANUAL",
      topupId: "t5",
      reason: "Single amount match in time window",
    });
  });

  it("does NOT auto-credit on amount heuristic — MANUAL only", () => {
    const d = decideMatch(
      {
        amount: 75,
        senderMsisdn: null,
        reference: null,
        rawMessage: "N$75",
        receivedAt,
      },
      [
        baseTopup({
          id: "t5",
          expectedAmount: 75,
          createdAt: new Date("2026-09-08T11:55:00Z"),
        }),
      ],
      15,
      now
    );
    expect(d.kind).toBe("MANUAL");
  });

  it("returns UNMATCHED when multiple amount candidates in window", () => {
    const deposit: DepositSnapshot = {
      amount: 100,
      senderMsisdn: null,
      reference: null,
      rawMessage: "N$100.00",
      receivedAt,
    };
    const topups = [
      baseTopup({
        id: "a",
        refCode: "BET1",
        expectedAmount: 100,
        createdAt: new Date("2026-09-08T11:50:00Z"),
      }),
      baseTopup({
        id: "b",
        refCode: "BET2",
        expectedAmount: 100,
        createdAt: new Date("2026-09-08T11:52:00Z"),
      }),
    ];
    expect(decideMatch(deposit, topups, 15, now).kind).toBe("UNMATCHED");
  });

  it("ignores expired top-ups", () => {
    const deposit: DepositSnapshot = {
      amount: 100,
      senderMsisdn: null,
      reference: "BET4821",
      rawMessage: "BET4821 N$100",
      receivedAt,
    };
    const topups = [
      baseTopup({
        id: "exp",
        refCode: "BET4821",
        expiresAt: new Date("2026-09-08T10:00:00Z"),
      }),
    ];
    expect(decideMatch(deposit, topups, 15, now).kind).toBe("UNMATCHED");
  });

  it("returns UNMATCHED for zero amount", () => {
    expect(
      decideMatch(
        {
          amount: 0,
          senderMsisdn: null,
          reference: null,
          rawMessage: "garbage",
          receivedAt,
        },
        [],
        15,
        now
      ).kind
    ).toBe("UNMATCHED");
  });
});
