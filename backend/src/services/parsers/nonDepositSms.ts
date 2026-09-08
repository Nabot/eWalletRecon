/**
 * Filter provider SMS that are not deposit credits (PIN/OTP/greeting).
 * BlueVoucher/PayPulse often send a second "Dear customer…" PIN SMS after the credit.
 */

export function isNonDepositSms(raw: string): boolean {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return true;

  const looksLikeCredit =
    /credited\s+with|is credited|sent you|received\s+(an?\s+)?(easy\s*wallet|nad|n[$¤]|ewallet)|a\/c\s+\d+/i.test(
      t
    );

  // Explicit BlueVoucher cash-out PIN SMS (never a deposit credit)
  if (/bluevoucher\s+pin\b/i.test(t) && !looksLikeCredit) {
    return true;
  }

  // Greeting / PIN follow-up without a credit line
  if (/^dear\s+customer\b/i.test(t) && !looksLikeCredit) {
    return true;
  }

  // Standalone OTP / PIN messages (not FNB "sent you … PIN 12345" cash-out credits)
  if (/\b(otp|one[-\s]?time\s+pin|your\s+pin)\b/i.test(t) && !looksLikeCredit) {
    return true;
  }

  if (/\bpin\b/i.test(t) && /valid for\s+\d+/i.test(t) && !looksLikeCredit) {
    return true;
  }

  return false;
}
