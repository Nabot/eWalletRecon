import type { WalletProvider } from "@prisma/client";
import type { SmsParser, ParsedSms } from "./types";
import { paypulseParser } from "./paypulse";
import { easywalletParser } from "./easywallet";
import { pay2cellParser } from "./pay2cell";
import { ewalletParser } from "./ewallet";

const parsers: SmsParser[] = [paypulseParser, easywalletParser, pay2cellParser, ewalletParser];

const byProvider = new Map<WalletProvider, SmsParser>(
  parsers.map((p) => [p.provider, p])
);

export function getParser(provider: WalletProvider): SmsParser {
  const p = byProvider.get(provider);
  if (!p) throw new Error(`No parser for provider ${provider}`);
  return p;
}

export function parseSms(provider: WalletProvider, rawText: string): ParsedSms | null {
  return getParser(provider).parse(rawText);
}

/**
 * Try the wallet's provider parser first, then other providers.
 * Useful when a handset receives SMS from multiple e-wallet brands.
 */
export function parseSmsWithFallback(
  preferred: WalletProvider,
  rawText: string
): { parsed: ParsedSms; provider: WalletProvider } | null {
  const primary = parseSms(preferred, rawText);
  if (primary) return { parsed: primary, provider: preferred };

  for (const p of parsers) {
    if (p.provider === preferred) continue;
    const parsed = p.parse(rawText);
    if (parsed) return { parsed, provider: p.provider };
  }
  return null;
}


/** All known SMS sender IDs across providers (for Android filter sync). */
export function allSenderIds(): { provider: WalletProvider; senderIds: string[] }[] {
  return parsers.map((p) => ({ provider: p.provider, senderIds: p.senderIds }));
}

export { parsers };
export type { SmsParser, ParsedSms };
