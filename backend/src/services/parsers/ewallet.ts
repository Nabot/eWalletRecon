/**
 * FNB eWallet receive SMS (Namibia).
 *
 * Real sample (Aug 2026):
 *   FNB :) N T NABOT sent you N¤4500.00. Get cash at Cash Plus partner or
 *   Press PROCEED at FNB ATM. PIN 37262, is valid for 16hrs.
 *   If PIN expired, dial *140*392#
 *
 * Notes:
 * - Currency often appears as N¤ (not N$).
 * - Counterparty is a person name — no MSISDN in the SMS.
 * - PIN is for cash-out; not used as a match reference unless a BET#### appears.
 */
import type { SmsParser, ParsedSms } from "./types";
import { extractAmount, extractRefCode, extractSenderName, collapseWhitespace } from "./types";

export const ewalletParser: SmsParser = {
  provider: "EWALLET",
  senderIds: ["362626", "FNB", "eWallet", "EWALLET", "FNB eWallet"],
  parse(rawText: string): ParsedSms | null {
    const text = collapseWhitespace(rawText);
    if (!/\bFNB\b|e\s*wallet|sent\s+you\s+N[\$¤]/i.test(text)) {
      return null;
    }
    // Avoid confusing with EasyWallet
    if (/easy\s*wallet/i.test(text)) return null;

    const amount = extractAmount(text);
    if (amount == null) return null;

    return {
      amount,
      senderMsisdn: null,
      senderName: extractSenderName(text),
      reference: extractRefCode(text),
      timestamp: null,
    };
  },
};
