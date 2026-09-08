package com.ewallet.capture.util

import java.security.MessageDigest

fun sha256Hex(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
}

fun smsIdempotencyKey(sender: String, body: String, receivedAtMs: Long): String =
    sha256Hex("$sender|$body|$receivedAtMs")
