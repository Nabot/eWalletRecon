package com.ewallet.capture.data.worker

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.ewallet.capture.BuildConfig
import com.ewallet.capture.data.api.CaptureApiClient
import com.ewallet.capture.data.api.HeartbeatTelemetry
import com.ewallet.capture.data.db.CaptureDatabase
import com.ewallet.capture.util.Prefs
import com.ewallet.capture.util.WorkScheduler
import kotlinx.coroutines.flow.first
import org.json.JSONArray

class HeartbeatWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        prefs.ensureMigrated()
        val apiKey = prefs.apiKey.first()
        val base = prefs.apiBase.first()
        if (apiKey.isBlank()) {
            scheduleNext()
            return Result.success()
        }

        return try {
            val dao = CaptureDatabase.get(applicationContext).pendingSmsDao()
            val pending = dao.countPending(SyncWorker.MAX_ATTEMPTS)
            val smsOk = ContextCompat.checkSelfPermission(
                applicationContext,
                Manifest.permission.RECEIVE_SMS
            ) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(
                    applicationContext,
                    Manifest.permission.READ_SMS
                ) == PackageManager.PERMISSION_GRANTED

            val client = CaptureApiClient(base, apiKey)
            val wantPong = prefs.consumePongRequest()
            val hb = client.heartbeat(
                HeartbeatTelemetry(
                    appVersionName = BuildConfig.VERSION_NAME,
                    appVersionCode = BuildConfig.VERSION_CODE,
                    pendingSmsCount = pending,
                    lastSyncAtEpochMs = prefs.lastSyncMs.first(),
                    lastError = prefs.lastError.first(),
                    lastErrorAtEpochMs = prefs.lastErrorMs.first(),
                    smsPermissionOk = smsOk,
                    pong = wantPong,
                )
            )
            if (!hb.ok) {
                prefs.setLastError("Heartbeat HTTP ${hb.httpCode}${hb.errorBody?.let { ": $it" } ?: ""}")
                scheduleNext()
                return Result.retry()
            }
            prefs.setLastHeartbeat(System.currentTimeMillis(), hb.offlineAfterMinutes)
            prefs.setMinVersionCode(hb.minVersionCode)

            if (hb.commands.pong) {
                prefs.markPongRequested()
                WorkScheduler.scheduleHeartbeat(applicationContext, 0)
            }
            if (hb.commands.forceSync) {
                WorkScheduler.enqueueSyncNow(applicationContext)
            }
            if (hb.commands.wipe) {
                Log.w(TAG, "Remote wipe received — clearing sealed connection")
                prefs.resetConnection()
                scheduleNext()
                return Result.success()
            }

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
