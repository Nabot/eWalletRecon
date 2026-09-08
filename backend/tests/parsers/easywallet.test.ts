import { describe, it, expect } from "vitest";
import { easywalletParser } from "../../src/services/parsers/easywallet";
import { decideMatch } from "../../src/services/matching/decide";

const REAL_EASYWALLET =
  "Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an EasyWallet of NAD5000.00 OTP:529998 valid for 24h. If expired, dial *140*295# for a new OTP. REF:20260820-71391772";

describe("easywalletParser (Bank WHK)", () => {
  it("parses real EasyWallet receive SMS using REF: as reference", () => {
    const p = easywalletParser.parse(REAL_EASYWALLET);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(5000);
    expect(p!.senderMsisdn).toBeNull();
    expect(p!.senderName).toBe("Byte-Able Investment CC/2015/04028");
    expect(p!.reference).toBe("20260820-71391772");
  });

  it("keeps REF: as reference even if a BET code also appears", () => {
    const p = easywalletParser.parse(`${REAL_EASYWALLET} BET4822`);
    expect(p!.reference).toBe("20260820-71391772");
  });

  it("auto-matches top-up when refCode equals EasyWallet REF", () => {
    const now = new Date("2026-08-20T12:00:00Z");
    const d = decideMatch(
      {
        amount: 5000,
        senderMsisdn: null,
        reference: "20260820-71391772",
        rawMessage: REAL_EASYWALLET,
        receivedAt: now,
      },
      [
        {
          id: "t-ew",
          refCode: "20260820-71391772",
          expectedAmount: 5000,
          userMsisdn: "264811111111",
          status: "AWAITING",
          expiresAt: new Date(now.getTime() + 3600_000),
          createdAt: now,
        },
      ],
      15,
      now
    );
    expect(d).toEqual({ kind: "AUTO", matchType: "REF_CODE", topupId: "t-ew" });
  });

  it("returns null without EasyWallet cue", () => {
    expect(easywalletParser.parse("FNB :) someone sent you N¤100.00")).toBeNull();
  });
});
