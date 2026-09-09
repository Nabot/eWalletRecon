/**
 * Bank Windhoek bank-transfer SMS (same sender line as EasyWallet: 140295).
 *
 * Sample:
 *   Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an of NAD5000.00 O.
 *   REF:0813544045
 *
 * Distinguisher vs EasyWallet: no "EasyWallet" keyword; REF is a cellphone
 * used for PstBet account lookup (stored as reference + senderMsisdn).
 */
import type { SmsParser, ParsedSms } from "./types";
import {
  extractAmount,
  extractEasyWalletRef,
  extractSenderName,
  collapseWhitespace,
  normalizeMsisdn,
} from "./types";

/** True when REF looks like a Namibian / local mobile (not EasyWallet txn id). */
export function isPhoneLikeRef(ref: string | null | undefined): boolean {
  if (!ref?.trim()) return false;
  // EasyWallet txn refs look like 20260820-71391772
  if (/^\d{8}-\d+$/.test(ref.trim())) return false;
  const n = normalizeMsisdn(ref);
  if (!n) return false;
  // Local 0xxxxxxxxx → 264… (11–12 digits) or raw long MSISDN
  return n.startsWith("264") ? n.length >= 11 && n.length <= 12 : n.length >= 9 && n.length <= 15;
}

export const bankWhkParser: SmsParser = {
  provider: "BANK_WHK",
  senderIds: ["140295", "Bank WHK", "BankWHK", "WHK"],
  parse(rawText: string): ParsedSms | null {
    const text = collapseWhitespace(rawText);
    if (!/bank\s*whk/i.test(text)) return null;
    // EasyWallet product SMS stays on the EasyWallet parser
    if (/easy\s*wallet/i.test(text)) return null;

    const amount = extractAmount(text);
    if (amount == null) return null;

    const ref = extractEasyWalletRef(text);
    if (!isPhoneLikeRef(ref)) return null;

    const msisdn = normalizeMsisdn(ref!);
    return {
      amount,
      senderMsisdn: msisdn,
      senderName: extractSenderName(text),
      reference: msisdn ?? ref,
      timestamp: null,
    };
  },
};
