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
  isPhoneLikeRef,
} from "./types";

export { isPhoneLikeRef };

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
