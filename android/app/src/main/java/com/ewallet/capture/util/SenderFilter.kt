package com.ewallet.capture.util

/**
 * Matches SMS originating addresses against the configured allowlist.
 * Short codes (≤6 chars after normalize) require exact equality to avoid
 * over-matching personal SMS; longer tokens may match as substring either way.
 */
object SenderFilter {
    fun normalize(raw: String): String =
        raw.trim().lowercase().replace(Regex("[^a-z0-9]"), "")

    fun matches(senderAddress: String, allowed: Set<String>): Boolean {
        if (allowed.isEmpty()) return false
        val senderNorm = normalize(senderAddress)
        if (senderNorm.isEmpty()) return false
        return allowed.any { token ->
            val id = normalize(token)
            if (id.isEmpty()) return@any false
            if (id.length <= 6) {
                senderNorm == id
            } else {
                senderNorm.contains(id) || id.contains(senderNorm)
            }
        }
    }
}
