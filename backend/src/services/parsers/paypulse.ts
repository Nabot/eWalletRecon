/**
 * PayPulse / BlueVoucher credit SMS.
 *
 * Real sample (Aug 2026):
 *   Your BlueVoucher a/c 264813544045
 *   is credited with
 *   NAD 1,750.00 on
 *   21/08/2026 16:32:12.
 *   Bal is NAD 1,750.00
 *   Reference#: 264813887790
 *
 * Notes:
 * - Branding on the phone may show as BlueVoucher (PayPulse product).
 * - Reference# is typically the counterparty MSISDN (sender).
 * - If the user includes a BET#### code in the transfer note, extractRefCode still picks it up.
 */
import type { SmsParser, ParsedSms } from "./types";
import {
  extractAmount,
  extractRefCode,
  extractProviderReference,
  extractSenderFromText,
  parseNamibianDateTime,
  normalizeMsisdn,
  collapseWhitespace,
} from "./types";

export const paypulseParser: SmsParser = {
  provider: "PAYPULSE",
  senderIds: ["PAYPULSE", "PayPulse", "BlueVoucher"],
  parse(rawText: string): ParsedSms | null {
    const text = collapseWhitespace(rawText);
    if (!/blue\s*voucher|pay\s*pulse|credited\s+with/i.test(text)) {
      return null;
    }
    const amount = extractAmount(text);
    if (amount == null) return null;

    const providerRef = extractProviderReference(text);
    const betCode = extractRefCode(text);
    const senderFromRef = providerRef ? normalizeMsisdn(providerRef) : null;

    return {
      amount,
      senderMsisdn: senderFromRef ?? extractSenderFromText(text),
      senderName: null,
      reference: betCode ?? providerRef,
      timestamp: parseNamibianDateTime(text),
    };
  },
};
