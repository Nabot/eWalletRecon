import { describe, it, expect } from "vitest";
import { isNonDepositSms } from "../../src/services/parsers/nonDepositSms";

describe("isNonDepositSms", () => {
  it("keeps BlueVoucher credit SMS", () => {
    const raw = `Your BlueVoucher a/c 264813544045 
is credited with 
NAD 1,750.00 on
21/08/2026 16:32:12.
Bal is NAD 1,750.00
Reference#: 264813887790`;
    expect(isNonDepositSms(raw)).toBe(false);
  });

  it("skips real BlueVoucher PIN follow-up SMS", () => {
    const raw = `Dear Customer,
Your BlueVoucher PIN is 4065.
This PIN is valid for 72 hrs, if PIN expired, dial *140*6626#. Use this PIN to withdraw cash at any Standard Bank ATM.
Queries 92860.`;
    expect(isNonDepositSms(raw)).toBe(true);
  });

  it("skips Dear customer greeting without credit language", () => {
    expect(isNonDepositSms("Dear Customer, thank you for using BlueVoucher.")).toBe(true);
  });

  it("keeps FNB credit that includes cash-out PIN", () => {
    const raw =
      "FNB :) N T NABOT sent you N¤4500.00. Get cash at Cash Plus partner or Press PROCEED at FNB ATM. PIN 37262, is valid for 16hrs. If PIN expired, dial *140*392#";
    expect(isNonDepositSms(raw)).toBe(false);
  });

  it("keeps EasyWallet credit that includes OTP", () => {
    const raw =
      "Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an EasyWallet of NAD5000.00 OTP:529998 valid for 24h. If expired, dial *140*295# for a new OTP. REF:20260820-71391772";
    expect(isNonDepositSms(raw)).toBe(false);
  });

  it("skips standalone OTP SMS", () => {
    expect(isNonDepositSms("Your OTP is 123456. Do not share.")).toBe(true);
  });
});
