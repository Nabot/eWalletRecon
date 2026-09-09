/**
 * EasyWallet (Bank Windhoek) receive SMS.
 *
 * Real sample (Aug 2026):
 *   Bank WHK:  Byte-Able Investment CC/2015/04028 sent you an EasyWallet of
 *   NAD5000.00 OTP:529998 valid for 24h. If expired, dial *140*295# for a new OTP.
 *   REF:20260820-71391772
 *
 * Notes:
 * - Must contain "EasyWallet" (Bank WHK bank-transfer SMS without that keyword
 *   is handled by bankWhkParser — REF is a cellphone).
 * - Sender is a name / business string, not an MSISDN (senderMsisdn stays null).
 * - Canonical reference is the SMS `REF:` value (e.g. 20260820-71391772).
 * - OTP is for redeeming the wallet — not used for matching.
 */
import type { SmsParser, ParsedSms } from "./types";
import {
  extractAmount,
  extractEasyWalletRef,
  extractSenderName,
  collapseWhitespace,
} from "./types";

export const easywalletParser: SmsParser = {
  provider: "EASYWALLET",
  senderIds: ["140295", "Bank WHK", "BankWHK", "EasyWallet", "EASYWALLET", "WHK"],
  parse(rawText: string): ParsedSms | null {
    const text = collapseWhitespace(rawText);
    if (!/easy\s*wallet/i.test(text)) {
      return null;
    }
    const amount = extractAmount(text);
    if (amount == null) return null;

    return {
      amount,
      senderMsisdn: null,
      senderName: extractSenderName(text),
      reference: extractEasyWalletRef(text),
      timestamp: null,
    };
  },
};
