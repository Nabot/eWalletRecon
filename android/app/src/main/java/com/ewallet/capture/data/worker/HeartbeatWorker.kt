package com.ewallet.capture.data.worker

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.ewallet.capture.data.api.CaptureApiClient
import com.ewallet.capture.util.Prefs
import com.ewallet.capture.util.WorkScheduler
import kotlinx.coroutines.flow.first
import org.json.JSONArray

class HeartbeatWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        val apiKey = prefs.apiKey.first()
        val base = prefs.apiBase.first()
        if (apiKey.isBlank()) {
            // Not configured — don't retry-spin; still re-chain so we pick up a key later.
            scheduleNext()
            return Result.success()
        }

        return try {
            val client = CaptureApiClient(base, apiKey)
            val hb = client.heartbeat()
            if (!hb.ok) {
                prefs.setLastError("Heartbeat HTTP ${hb.httpCode}${hb.errorBody?.let { ": $it" } ?: ""}")
                scheduleNext()
                return Result.retry()
            }
            prefs.setLastHeartbeat(System.currentTimeMillis(), hb.offlineAfterMinutes)

            val (code, cfg) = client.fetchConfig()
            if (cfg != null) {
                val wallet = cfg.optJSONObject("walletNumber")
                val senderIds = cfg.optJSONArray("senderIds") ?: JSONArray()
                val ids = mutableListOf<String>()
                for (i in 0 until senderIds.length()) {
                    val entry = senderIds.getJSONObject(i)
                    val arr = entry.optJSONArray("senderIds") ?: continue
                    for (j in 0 until arr.length()) ids.add(arr.getString(j).lowercase())
                }
                prefs.saveDeviceMeta(
                    name = cfg.optString("deviceName"),
                    label = wallet?.optString("label").orEmpty(),
                    msisdn = wallet?.optString("msisdn").orEmpty(),
                    senderIdsCsv = ids.distinct().joinToString(","),
                )
                prefs.clearLastError()
            } else if (code != 0) {
                prefs.setLastError("Config HTTP $code")
            }
            scheduleNext()
            Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Heartbeat failed", e)
            prefs.setLastError("Heartbeat: ${e.message ?: e.javaClass.simpleName}")
            scheduleNext()
            Result.retry()
        }
    }

    private fun scheduleNext() {
        WorkScheduler.scheduleHeartbeat(
            applicationContext,
            WorkScheduler.HEARTBEAT_INTERVAL_MINUTES
        )
    }

    companion object {
        const val UNIQUE_NAME = "ewallet_heartbeat"
        const val UNIQUE_ONESHOT = "ewallet_heartbeat_once"
        private const val TAG = "HeartbeatWorker"
    }
}
