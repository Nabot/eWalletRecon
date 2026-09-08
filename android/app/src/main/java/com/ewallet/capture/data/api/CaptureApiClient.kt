package com.ewallet.capture.data.api

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.TimeUnit
import com.ewallet.capture.BuildConfig

data class QueuedSms(
    val idempotencyKey: String,
    val rawMessage: String,
    val senderAddress: String,
    val receivedAtEpochMs: Long,
)

data class HeartbeatCommands(
    val forceSync: Boolean = false,
    val wipe: Boolean = false,
    val pong: Boolean = false,
)

data class HeartbeatResult(
    val ok: Boolean,
    val httpCode: Int,
    val offlineAfterMinutes: Long? = null,
    val minVersionCode: Int? = null,
    val commands: HeartbeatCommands = HeartbeatCommands(),
    val errorBody: String? = null,
)

data class HeartbeatTelemetry(
    val appVersionName: String,
    val appVersionCode: Int,
    val pendingSmsCount: Int,
    val lastSyncAtEpochMs: Long,
    val lastError: String,
    val lastErrorAtEpochMs: Long,
    val smsPermissionOk: Boolean,
    val pong: Boolean = false,
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

    fun heartbeat(telemetry: HeartbeatTelemetry = HeartbeatTelemetry(
        appVersionName = BuildConfig.VERSION_NAME,
        appVersionCode = BuildConfig.VERSION_CODE,
        pendingSmsCount = 0,
        lastSyncAtEpochMs = 0L,
        lastError = "",
        lastErrorAtEpochMs = 0L,
        smsPermissionOk = true,
        pong = false,
    )): HeartbeatResult {
        val payload = JSONObject()
            .put("appVersionName", telemetry.appVersionName)
            .put("appVersionCode", telemetry.appVersionCode)
            .put("pendingSmsCount", telemetry.pendingSmsCount)
            .put("smsPermissionOk", telemetry.smsPermissionOk)
        if (telemetry.lastSyncAtEpochMs > 0L) {
            payload.put("lastSyncAt", Instant.ofEpochMilli(telemetry.lastSyncAtEpochMs).toString())
        } else {
            payload.put("lastSyncAt", JSONObject.NULL)
        }
        if (telemetry.lastError.isNotBlank()) {
            payload.put("lastError", telemetry.lastError.take(400))
            if (telemetry.lastErrorAtEpochMs > 0L) {
                payload.put("lastErrorAt", Instant.ofEpochMilli(telemetry.lastErrorAtEpochMs).toString())
            }
        } else {
            payload.put("lastError", JSONObject.NULL)
            payload.put("lastErrorAt", JSONObject.NULL)
        }
        if (telemetry.pong) payload.put("pong", true)

        val req = Request.Builder()
            .url(trimSlash(baseUrl) + "/api/capture/heartbeat")
            .header("X-Api-Key", apiKey)
            .post(payload.toString().toRequestBody(json))
            .build()
        client.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                return HeartbeatResult(false, res.code, errorBody = body.take(200))
            }
            val obj = runCatching { JSONObject(body) }.getOrNull()
            val commands = obj?.optJSONObject("commands")
            return HeartbeatResult(
                ok = true,
                httpCode = res.code,
                offlineAfterMinutes = obj?.optLong("offlineAfterMinutes")?.takeIf { it > 0 },
                minVersionCode = obj?.optInt("minVersionCode")?.takeIf { it > 0 },
                commands = HeartbeatCommands(
                    forceSync = commands?.optBoolean("forceSync") == true,
                    wipe = commands?.optBoolean("wipe") == true,
                    pong = commands?.optBoolean("pong") == true,
                ),
            )
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
            return batch.map { it.idempotencyKey }
        }
    }

    private fun trimSlash(url: String) = url.trimEnd('/')
}
