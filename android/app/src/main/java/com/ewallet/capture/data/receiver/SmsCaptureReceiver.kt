package com.ewallet.capture.data.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.ewallet.capture.data.db.CaptureDatabase
import com.ewallet.capture.data.db.PendingSmsEntity
import com.ewallet.capture.util.Prefs
import com.ewallet.capture.util.SenderFilter
import com.ewallet.capture.util.WorkScheduler
import com.ewallet.capture.util.smsIdempotencyKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * Captures incoming SMS from known e-wallet sender IDs and enqueues for sync.
 * Confirmed IDs: PAYPULSE, 362626 (FNB), 140295 (EasyWallet).
 * Also refreshed from GET /api/capture/config on heartbeat.
 */
class SmsCaptureReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (messages.isEmpty()) return

        val pending = goAsync()
        Thread {
            try {
                val prefs = Prefs(context)
                val allowed = runBlocking { prefs.senderIds.first() }
                val bySender = messages.groupBy { it.displayOriginatingAddress.orEmpty() }

                val dao = CaptureDatabase.get(context).pendingSmsDao()
                var enqueued = false

                for ((sender, parts) in bySender) {
                    if (!SenderFilter.matches(sender, allowed)) continue

                    val body = parts.joinToString(separator = "") { it.displayMessageBody.orEmpty() }
                    if (body.isBlank()) continue

                    val receivedAt = parts.minOf { it.timestampMillis }
                    val key = smsIdempotencyKey(sender, body, receivedAt)
                    runBlocking {
                        val rowId = dao.insert(
                            PendingSmsEntity(
                                idempotencyKey = key,
                                rawMessage = body,
                                senderAddress = sender,
                                receivedAtEpochMs = receivedAt,
                            )
                        )
                        if (rowId != -1L) enqueued = true
                    }
                }

                if (enqueued) {
                    WorkScheduler.enqueueSyncNow(context)
                }
            } catch (e: Exception) {
                Log.e(TAG, "SMS capture failed", e)
                runBlocking {
                    Prefs(context).setLastError("SMS capture: ${e.message ?: e.javaClass.simpleName}")
                }
            } finally {
                pending.finish()
            }
        }.start()
    }

    companion object {
        private const val TAG = "SmsCaptureReceiver"
    }
}
