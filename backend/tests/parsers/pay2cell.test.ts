import { describe, it, expect } from "vitest";
import { pay2cellParser } from "../../src/services/parsers/pay2cell";

describe("pay2cellParser (placeholder — awaiting real SMS)", () => {
  it("parses generic Pay2Cell-shaped message", () => {
    const raw = "Pay2Cell: Deposit of NAD 50.00 from 0813333333. Reference: BET4823";
    const p = pay2cellParser.parse(raw);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(50);
    expect(p!.senderMsisdn).toBe("264813333333");
    expect(p!.reference).toBe("BET4823");
  });
});
