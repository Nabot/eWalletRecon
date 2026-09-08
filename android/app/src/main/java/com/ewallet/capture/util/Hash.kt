package com.ewallet.capture.util

import java.security.MessageDigest

fun sha256Hex(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
}

/**
 * Stable SMS idempotency key shared by broadcast + inbox backfill.
 *
 * Do **not** include the SMS timestamp: PDU time and inbox DATE often differ by
 * milliseconds, which previously created two keys for one message and doubled
 * deposits on the server.
 */
fun smsIdempotencyKey(sender: String, body: String, @Suppress("UNUSED_PARAMETER") receivedAtMs: Long = 0L): String =
    sha256Hex("${SenderFilter.normalize(sender)}|${body.trim()}")
