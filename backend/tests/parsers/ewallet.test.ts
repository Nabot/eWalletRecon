import { describe, it, expect } from "vitest";
import { ewalletParser } from "../../src/services/parsers/ewallet";

const REAL_FNB =
  "FNB :) N T NABOT sent you N¤4500.00. Get cash at Cash Plus partner or Press PROCEED at FNB ATM. PIN 37262, is valid for 16hrs. If PIN expired, dial *140*392#";

describe("ewalletParser (FNB eWallet)", () => {
  it("parses real FNB eWallet SMS with N¤ amount", () => {
    const p = ewalletParser.parse(REAL_FNB);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(4500);
    expect(p!.senderMsisdn).toBeNull();
    expect(p!.senderName).toBe("N T NABOT");
    expect(p!.reference).toBeNull();
  });

  it("extracts BET code when present", () => {
    const p = ewalletParser.parse(`${REAL_FNB} BET9001`);
    expect(p!.amount).toBe(4500);
    expect(p!.reference).toBe("BET9001");
  });

  it("does not parse EasyWallet as FNB eWallet", () => {
    expect(
      ewalletParser.parse(
        "Bank WHK: X sent you an EasyWallet of NAD100.00 REF:1"
      )
    ).toBeNull();
  });
});
