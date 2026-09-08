package com.ewallet.capture.data.worker

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.ewallet.capture.data.api.CaptureApiClient
import com.ewallet.capture.data.api.QueuedSms
import com.ewallet.capture.data.db.CaptureDatabase
import com.ewallet.capture.data.inbox.InboxScanner
import com.ewallet.capture.util.Prefs
import kotlinx.coroutines.flow.first

class SyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        prefs.ensureMigrated()
        val dao = CaptureDatabase.get(applicationContext).pendingSmsDao()
        prefs.applyCatchupPolicyV3IfNeeded {
            dao.deleteAll()
            Log.i(TAG, "Catch-up policy v3: cleared pending queue + reset inbox watermark")
        }
        val apiKey = prefs.apiKey.first()
        val base = prefs.apiBase.first()
        if (apiKey.isBlank()) {
            return Result.success()
        }

        // Catch SMS missed while the process was dead / permissions pending.
        // Does not scan days of inbox history (watermark init / policy v3).
        try {
            InboxScanner.scanAndEnqueue(applicationContext)
        } catch (e: Exception) {
            Log.w(TAG, "Inbox scan failed", e)
            prefs.setLastError("Inbox scan: ${e.message ?: e.javaClass.simpleName}")
        }

        val batch = dao.peek(50, MAX_ATTEMPTS)
        if (batch.isEmpty()) {
            return Result.success()
        }

        return try {
            val client = CaptureApiClient(base, apiKey)
            val accepted = client.syncSms(
                batch.map {
                    QueuedSms(
                        idempotencyKey = it.idempotencyKey,
                        rawMessage = it.rawMessage,
                        senderAddress = it.senderAddress,
                        receivedAtEpochMs = it.receivedAtEpochMs,
                    )
                }
            )
            if (accepted.isNotEmpty()) {
                dao.deleteKeys(accepted)
                prefs.setLastSync(System.currentTimeMillis())
                prefs.clearLastError()
            }
            Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Sync failed", e)
            dao.bumpAttempts(batch.map { it.idempotencyKey })
            prefs.setLastError("Sync: ${e.message ?: e.javaClass.simpleName}")
            Result.retry()
        }
    }

    companion object {
        const val UNIQUE_NAME = "ewallet_sms_sync"
        const val UNIQUE_ONESHOT = "ewallet_sms_sync_once"
        const val MAX_ATTEMPTS = 8
        private const val TAG = "SyncWorker"
    }
}
