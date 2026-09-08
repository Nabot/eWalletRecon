package com.ewallet.capture.data.api

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.TimeUnit

data class QueuedSms(
    val idempotencyKey: String,
    val rawMessage: String,
    val senderAddress: String,
    val receivedAtEpochMs: Long,
)

data class HeartbeatResult(
    val ok: Boolean,
    val httpCode: Int,
    val offlineAfterMinutes: Long? = null,
    val errorBody: String? = null,
)

class CaptureApiClient(
    private val baseUrl: String,
    private val apiKey: String,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    fun heartbeat(): HeartbeatResult {
        val req = Request.Builder()
            .url(trimSlash(baseUrl) + "/api/capture/heartbeat")
            .header("X-Api-Key", apiKey)
            .post("{}".toRequestBody(json))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                return HeartbeatResult(false, res.code, errorBody = body.take(200))
            }
            val offline = runCatching {
                JSONObject(body).optLong("offlineAfterMinutes").takeIf { it > 0 }
            }.getOrNull()
            return HeartbeatResult(true, res.code, offlineAfterMinutes = offline)
        }
    }

    fun fetchConfig(): Pair<Int, JSONObject?> {
        val req = Request.Builder()
            .url(trimSlash(baseUrl) + "/api/capture/config")
            .header("X-Api-Key", apiKey)
            .get()
            .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return res.code to null
            return res.code to JSONObject(res.body?.string().orEmpty())
        }
    }

    /** Returns keys that were accepted (created or already known). */
    fun syncSms(batch: List<QueuedSms>): List<String> {
        if (batch.isEmpty()) return emptyList()
        val messages = JSONArray()
        for (m in batch) {
            messages.put(
                JSONObject()
                    .put("rawMessage", m.rawMessage)
                    .put("receivedAt", Instant.ofEpochMilli(m.receivedAtEpochMs).toString())
                    .put("idempotencyKey", m.idempotencyKey)
                    .put("senderAddress", m.senderAddress)
            )
        }
        val body = JSONObject().put("messages", messages).toString()
        val req = Request.Builder()
            .url(trimSlash(baseUrl) + "/api/capture/sms")
            .header("X-Api-Key", apiKey)
            .post(body.toRequestBody(json))
            .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IllegalStateException("Sync failed HTTP ${res.code}")
            // On success, all keys in batch are safe to drop (server is idempotent)
            return batch.map { it.idempotencyKey }
        }
    }

    private fun trimSlash(url: String) = url.trimEnd('/')
}
