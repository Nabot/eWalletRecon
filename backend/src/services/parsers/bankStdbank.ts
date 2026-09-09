/**
 * Standard Bank Namibia account-credit SMS (bank transfer).
 *
 * Sample:
 *   Your Acc XX7600 has been credited with NAD 1,851.50. Ref: 0813544045.
 *   Available balance: NAD 5,034.73. 08/09/26 05:07:17. Queries? 92860
 *
 * Ref is the customer's cellphone (PstBet lookup). Channel: BANK.
 */
import type { SmsParser, ParsedSms } from "./types";
import {
  extractAmount,
  extractProviderReference,
  collapseWhitespace,
  normalizeMsisdn,
  isPhoneLikeRef,
  parseNamibianDateTime,
} from "./types";

export const bankStdbankParser: SmsParser = {
  provider: "BANK_STDBANK",
  senderIds: ["StdBank", "STDBANK", "StandardBank", "Standard Bank", "92860"],
  parse(rawText: string): ParsedSms | null {
    const text = collapseWhitespace(rawText);
    // Masked account credit — not BlueVoucher / PayPulse
    if (!/your\s+acc\s+[A-Z0-9X]+\s+has\s+been\s+credited\s+with/i.test(text)) {
      return null;
    }
    if (/blue\s*voucher|pay\s*pulse/i.test(text)) return null;

    const amount = extractAmount(text);
    if (amount == null) return null;

    const ref = extractProviderReference(text);
    if (!isPhoneLikeRef(ref)) return null;

    const msisdn = normalizeMsisdn(ref!);
    return {
      amount,
      senderMsisdn: msisdn,
      senderName: null,
      reference: msisdn ?? ref,
      timestamp: parseNamibianDateTime(text),
    };
  },
};
