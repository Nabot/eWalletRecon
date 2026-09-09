import { describe, it, expect } from "vitest";
import { bankStdbankParser } from "../../src/services/parsers/bankStdbank";
import { paypulseParser } from "../../src/services/parsers/paypulse";
import { parseSmsWithFallback } from "../../src/services/parsers";

const STD_BANK =
  "Your Acc XX7600 has been credited with NAD 1,851.50. Ref: 0813544045. Available balance: NAD 5,034.73. 08/09/26 05:07:17. Queries? 92860";

describe("bankStdbankParser", () => {
  it("parses Standard Bank credit SMS with cellphone Ref", () => {
    const p = bankStdbankParser.parse(STD_BANK);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(1851.5);
    expect(p!.senderMsisdn).toBe("264813544045");
    expect(p!.reference).toBe("264813544045");
    expect(p!.timestamp).not.toBeNull();
    expect(p!.timestamp!.toISOString()).toBe("2026-09-08T03:07:17.000Z"); // CAT = UTC+2
  });

  it("returns null without phone-like Ref", () => {
    expect(
      bankStdbankParser.parse(
        "Your Acc XX7600 has been credited with NAD 100.00. Ref: ABC123. Available balance: NAD 1.00."
      )
    ).toBeNull();
  });

  it("does not steal BlueVoucher SMS", () => {
    const blue = `Your BlueVoucher a/c 264813544045 is credited with NAD 1,750.00 on 21/08/2026 16:32:12. Bal is NAD 1,750.00 Reference#: 264813887790`;
    expect(bankStdbankParser.parse(blue)).toBeNull();
    expect(paypulseParser.parse(blue)).not.toBeNull();
  });

  it("classifies via fallback as BANK_STDBANK", () => {
    const hit = parseSmsWithFallback("EASYWALLET", STD_BANK);
    expect(hit).not.toBeNull();
    expect(hit!.provider).toBe("BANK_STDBANK");
    expect(hit!.parsed.amount).toBe(1851.5);
  });
});

describe("paypulse vs Standard Bank", () => {
  it("PayPulse ignores Standard Bank Acc credit SMS", () => {
    expect(paypulseParser.parse(STD_BANK)).toBeNull();
  });
});
