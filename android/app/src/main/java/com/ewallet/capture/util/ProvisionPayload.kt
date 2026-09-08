package com.ewallet.capture.util

import org.json.JSONObject

/**
 * Provision payload shown once when an admin creates a device (QR / copy / MDM).
 *
 * ```json
 * { "v": 1, "apiBase": "https://…", "apiKey": "…" }
 * ```
 */
data class ProvisionPayload(
    val apiBase: String,
    val apiKey: String,
) {
    fun toJson(): String = JSONObject()
        .put("v", 1)
        .put("apiBase", apiBase.trimEnd('/'))
        .put("apiKey", apiKey.trim())
        .toString()

    companion object {
        fun parse(raw: String): ProvisionPayload? {
            val text = raw.trim()
            if (text.isEmpty()) return null
            return try {
                // Accept bare API key (manual paste)
                if (!text.startsWith("{")) {
                    return ProvisionPayload(apiBase = "", apiKey = text)
                }
                val obj = JSONObject(text)
                val key = obj.optString("apiKey").ifBlank { obj.optString("api_key") }
                val base = obj.optString("apiBase").ifBlank { obj.optString("api_base") }
                if (key.isBlank()) null
                else ProvisionPayload(apiBase = base.trimEnd('/'), apiKey = key.trim())
            } catch (_: Exception) {
                null
            }
        }
    }
}
