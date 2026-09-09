/**
 * SMS parser shared helpers.
 * Provider modules parse known templates; rawMessage is always stored for reparse.
 */

import type { WalletProvider } from "@prisma/client";
import type { ParsedSms } from "@ewallet/shared";

export type { ParsedSms };

export interface SmsParser {
  readonly provider: WalletProvider;
  /** Known SMS sender addresses / short codes as seen on the phone. */
  readonly senderIds: string[];
  parse(rawText: string): ParsedSms | null;
}

/** Normalize Namibian MSISDN to digits starting with 264 when possible. */
export function normalizeMsisdn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (d.startsWith("0") && d.length === 10) d = `264${d.slice(1)}`;
  if (d.startsWith("264") && d.length >= 11 && d.length <= 12) return d;
  if (/^\d{8,15}$/.test(d)) return d;
  return null;
}

function parseAmountToken(token: string): number | null {
  const n = Number(token.replace(/,/g, ""));
  if (Number.isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Extract NAD amount. Prefers "credited with" / "EasyWallet of" / "sent you"
 * over trailing balance lines.
 * Handles: NAD 1,750.00 | NAD5000.00 | N$4500 | N¤4500.00 (FNB)
 */
export function extractAmount(text: string): number | null {
  const preferred = [
    /credited\s+with\s+NAD\s*([\d,]+(?:\.\d{1,2})?)/i,
    /EasyWallet\s+of\s+NAD\s*([\d,]+(?:\.\d{1,2})?)/i,
    /sent\s+you\s+N[\$¤]\s*([\d,]+(?:\.\d{1,2})?)/i,
    /sent\s+you\s+NAD\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const p of preferred) {
    const m = text.match(p);
    if (m) {
      const n = parseAmountToken(m[1]);
      if (n != null) return n;
    }
  }

  const fallback = [
    /N[\$¤]\s*([\d,]+(?:\.\d{1,2})?)/i,
    /NAD\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:NAD|N[\$¤])/i,
  ];
  for (const p of fallback) {
    const m = text.match(p);
    if (m) {
      const n = parseAmountToken(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

/** Extract BET#### style betting top-up codes when present. */
export function extractRefCode(text: string): string | null {
  const m = text.match(/\b(BET\d{3,6})\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Provider transaction / Reference# values (not necessarily BET codes). */
export function extractProviderReference(text: string): string | null {
  const patterns = [
    /Reference\s*#\s*[:.]?\s*([A-Z0-9\-]+)/i,
    /\bREF\s*:\s*([A-Za-z0-9\-]+)/i,
    /\bREF\s+([A-Za-z0-9\-]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

/** EasyWallet Bank WHK — canonical match key is the REF: value. */
export function extractEasyWalletRef(text: string): string | null {
  const m = collapseWhitespace(text).match(/\bREF\s*:\s*([A-Za-z0-9\-]+)/i);
  return m ? m[1].trim() : null;
}

/**
 * Resolve the deposit reference used for top-up matching.
 * Prefers stored reference, then BET####, then EasyWallet REF:, then provider Reference#.
 */
export function resolveMatchReference(
  reference: string | null | undefined,
  rawMessage: string
): string | null {
  if (reference?.trim()) return reference.trim();
  return (
    extractRefCode(rawMessage) ||
    extractEasyWalletRef(rawMessage) ||
    extractProviderReference(rawMessage)
  );
}

export function extractSenderFromText(text: string): string | null {
  const patterns = [
    /(?:from|sender|by)[:\s]+(\+?264\d{9}|0\d{9})/i,
    /(?:from|sender|by)[:\s]+(\d{8,15})/i,
    /Reference\s*#\s*[:.]?\s*(264\d{9}|0\d{9})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return normalizeMsisdn(m[1]);
  }
  return null;
}

/**
 * Person / business name from "X sent you …" style SMS (FNB, EasyWallet).
 */
export function extractSenderName(text: string): string | null {
  const cleaned = collapseWhitespace(text)
    .replace(/^FNB\s*:\)\s*/i, "")
    .replace(/^Bank\s*WHK\s*:\s*/i, "")
    .trim();
  const m = cleaned.match(/^(.+?)\s+sent\s+you\b/i);
  if (!m) return null;
  const name = m[1].replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 120) return null;
  // Ignore if the capture is clearly a phone number
  if (/^[\d+\s\-]+$/.test(name)) return null;
  return name;
}

/** True when a REF looks like a Namibian / local mobile (not EasyWallet txn id). */
export function isPhoneLikeRef(ref: string | null | undefined): boolean {
  if (!ref?.trim()) return false;
  // EasyWallet txn refs look like 20260820-71391772
  if (/^\d{8}-\d+$/.test(ref.trim())) return false;
  const n = normalizeMsisdn(ref);
  if (!n) return false;
  // Local 0xxxxxxxxx → 264… (11–12 digits) or raw long MSISDN
  return n.startsWith("264") ? n.length >= 11 && n.length <= 12 : n.length >= 9 && n.length <= 15;
}

/** Parse dates like 21/08/2026 16:32:12 or 08/09/26 05:07:17 (Africa/Windhoek / CAT). */
export function parseNamibianDateTime(text: string): Date | null {
  const m = text.match(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\b/
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? "0");
  // Interpret as UTC+2 (CAT) without depending on host TZ
  const utcMs = Date.UTC(year, month - 1, day, hour - 2, minute, second);
  const d = new Date(utcMs);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
