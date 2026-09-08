/**
 * Pay2Cell — still PLACEHOLDER (no real SMS sample provided yet).
 * Supply a real Pay2Cell deposit SMS to finalise this parser.
 */
import type { SmsParser, ParsedSms } from "./types";
import {
  extractAmount,
  extractRefCode,
  extractSenderFromText,
  extractProviderReference,
  collapseWhitespace,
} from "./types";

export const pay2cellParser: SmsParser = {
  provider: "PAY2CELL",
  senderIds: ["Pay2Cell", "PAY2CELL", "P2C"],
  parse(rawText: string): ParsedSms | null {
    const text = collapseWhitespace(rawText);
    if (!/pay\s*2\s*cell|pay2cell|\bp2c\b/i.test(text)) {
      return null;
    }
    const amount = extractAmount(text);
    if (amount == null) return null;
    return {
      amount,
      senderMsisdn: extractSenderFromText(text),
      senderName: null,
      reference: extractRefCode(text) ?? extractProviderReference(text),
      timestamp: null,
    };
  },
};
