package com.ewallet.capture.util

/**
 * Drop provider follow-up SMS that are not deposit credits
 * (BlueVoucher "Dear customer" PIN, standalone OTP, etc.).
 */
object NonDepositSms {
    fun shouldIgnore(raw: String): Boolean {
        val t = raw.replace(Regex("\\s+"), " ").trim()
        if (t.isEmpty()) return true

        val looksLikeCredit = Regex(
            """credited\s+with|is credited|sent you|received\s+(an?\s+)?(easy\s*wallet|nad|n[$¤]|ewallet)|a/c\s+\d+""",
            RegexOption.IGNORE_CASE
        ).containsMatchIn(t)

        // Explicit BlueVoucher cash-out PIN SMS (never a deposit credit)
        if (Regex("""bluevoucher\s+pin\b""", RegexOption.IGNORE_CASE).containsMatchIn(t) && !looksLikeCredit) {
            return true
        }

        if (Regex("""^dear\s+customer\b""", RegexOption.IGNORE_CASE).containsMatchIn(t) && !looksLikeCredit) {
            return true
        }
        if (Regex("""\b(otp|one[-\s]?time\s+pin|your\s+pin)\b""", RegexOption.IGNORE_CASE).containsMatchIn(t) &&
            !looksLikeCredit
        ) {
            return true
        }
        if (Regex("""\bpin\b""", RegexOption.IGNORE_CASE).containsMatchIn(t) &&
            Regex("""valid for\s+\d+""", RegexOption.IGNORE_CASE).containsMatchIn(t) &&
            !looksLikeCredit
        ) {
            return true
        }
        return false
    }
}
