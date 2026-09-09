import { describe, it, expect } from "vitest";
import { bankWhkParser, isPhoneLikeRef } from "../../src/services/parsers/bankWhk";
import { easywalletParser } from "../../src/services/parsers/easywallet";
import { parseSmsWithFallback } from "../../src/services/parsers";

const BANK_TRANSFER =
  "Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an of NAD5000.00 O. REF:0813544045";

const EASYWALLET =
  "Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an EasyWallet of NAD5000.00 OTP:529998 valid for 24h. If expired, dial *140*295# for a new OTP. REF:20260820-71391772";

describe("isPhoneLikeRef", () => {
  it("accepts local and international mobiles", () => {
    expect(isPhoneLikeRef("0813544045")).toBe(true);
    expect(isPhoneLikeRef("264813544045")).toBe(true);
  });

  it("rejects EasyWallet-style txn refs", () => {
    expect(isPhoneLikeRef("20260820-71391772")).toBe(false);
  });
});

describe("bankWhkParser", () => {
  it("parses Bank WHK transfer with cellphone REF into senderMsisdn", () => {
    const p = bankWhkParser.parse(BANK_TRANSFER);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(5000);
    expect(p!.senderName).toBe("Byte-Able Investment CC/2015/04028");
    expect(p!.senderMsisdn).toBe("264813544045");
    expect(p!.reference).toBe("264813544045");
  });

  it("returns null for EasyWallet product SMS", () => {
    expect(bankWhkParser.parse(EASYWALLET)).toBeNull();
  });

  it("returns null when REF is not a phone", () => {
    expect(
      bankWhkParser.parse(
        "Bank WHK: Someone sent you an of NAD100.00 O. REF:20260820-71391772"
      )
    ).toBeNull();
  });
});

describe("Bank WHK vs EasyWallet fallback", () => {
  it("classifies bank transfer as BANK_WHK even when preferred is EASYWALLET", () => {
    const hit = parseSmsWithFallback("EASYWALLET", BANK_TRANSFER);
    expect(hit).not.toBeNull();
    expect(hit!.provider).toBe("BANK_WHK");
    expect(hit!.parsed.senderMsisdn).toBe("264813544045");
  });

  it("keeps EasyWallet as EASYWALLET", () => {
    expect(easywalletParser.parse(EASYWALLET)).not.toBeNull();
    const hit = parseSmsWithFallback("EASYWALLET", EASYWALLET);
    expect(hit!.provider).toBe("EASYWALLET");
    expect(hit!.parsed.reference).toBe("20260820-71391772");
    expect(hit!.parsed.senderMsisdn).toBeNull();
  });
});
