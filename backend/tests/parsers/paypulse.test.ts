import { describe, it, expect } from "vitest";
import { paypulseParser } from "../../src/services/parsers/paypulse";

const REAL_BLUEVOUCHER = `Your BlueVoucher a/c 264813544045 
is credited with 
NAD 1,750.00 on
21/08/2026 16:32:12.
Bal is NAD 1,750.00
Reference#: 264813887790`;

describe("paypulseParser (BlueVoucher)", () => {
  it("parses real BlueVoucher credit SMS", () => {
    const p = paypulseParser.parse(REAL_BLUEVOUCHER);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(1750);
    expect(p!.senderMsisdn).toBe("264813887790");
    expect(p!.reference).toBe("264813887790");
    expect(p!.timestamp).not.toBeNull();
    expect(p!.timestamp!.toISOString()).toBe("2026-08-21T14:32:12.000Z"); // CAT = UTC+2
  });

  it("prefers BET code over provider Reference# when both present", () => {
    const raw = `${REAL_BLUEVOUCHER}\nNote BET4821`;
    const p = paypulseParser.parse(raw);
    expect(p!.reference).toBe("BET4821");
    expect(p!.senderMsisdn).toBe("264813887790");
  });

  it("returns null for unrelated SMS", () => {
    expect(paypulseParser.parse("Your OTP is 123456")).toBeNull();
  });
});
