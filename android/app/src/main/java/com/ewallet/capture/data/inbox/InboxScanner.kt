package com.ewallet.capture.data.inbox

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import android.util.Log
import androidx.core.content.ContextCompat
import com.ewallet.capture.data.db.CaptureDatabase
import com.ewallet.capture.data.db.PendingSmsEntity
import com.ewallet.capture.util.Prefs
import com.ewallet.capture.util.SenderFilter
import com.ewallet.capture.util.smsIdempotencyKey
import kotlinx.coroutines.flow.first

data class InboxScanResult(
    val examined: Int = 0,
    val enqueued: Int = 0,
    val skippedHistoryInit: Boolean = false,
)

/**
 * Backfills allowlisted SMS from the device inbox using the same idempotency
 * keys as the live broadcast path.
 *
 * Important: if the inbox watermark was never set, we **initialize it to now**
 * and do **not** scan historical SMS. Scanning 7 days of history re-uploads
 * old FNB/PayPulse messages on every fresh install / key-format change.
 */
object InboxScanner {
    /** Only re-read slightly before watermark for clock skew / late provider writes. */
    private const val SKEW_MS = 2L * 60 * 1000
    private const val MAX_ROWS = 100
    private const val TAG = "InboxScanner"

    suspend fun scanAndEnqueue(context: Context): InboxScanResult {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return InboxScanResult()
        }

        val prefs = Prefs(context)
        val allowed = prefs.senderIds.first()
        if (allowed.isEmpty()) return InboxScanResult()

        var watermark = prefs.inboxWatermarkMs.first()
        if (watermark <= 0L) {
            val now = System.currentTimeMillis()
            prefs.setInboxWatermarkMs(now)
            Log.i(TAG, "Initialized inbox watermark to now — skipping historical SMS")
            return InboxScanResult(skippedHistoryInit = true)
        }

        val floor = (watermark - SKEW_MS).coerceAtLeast(0L)

        val projection = arrayOf(
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
        )
        val selection = "${Telephony.Sms.DATE} > ?"
        val args = arrayOf(floor.toString())
        val sort = "${Telephony.Sms.DATE} ASC"

        val dao = CaptureDatabase.get(context).pendingSmsDao()
        var examined = 0
        var enqueued = 0
        var maxDate = watermark

        context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            projection,
            selection,
            args,
            sort
        )?.use { cursor ->
            val iAddr = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val iBody = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val iDate = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)

            while (cursor.moveToNext() && examined < MAX_ROWS) {
                examined++
                val sender = cursor.getString(iAddr).orEmpty()
                val body = cursor.getString(iBody).orEmpty()
                val date = cursor.getLong(iDate)
                if (date > maxDate) maxDate = date
                if (body.isBlank()) continue
                if (!SenderFilter.matches(sender, allowed)) continue

                val rowId = dao.insert(
                    PendingSmsEntity(
                        idempotencyKey = smsIdempotencyKey(sender, body, date),
                        rawMessage = body,
                        senderAddress = sender,
                        receivedAtEpochMs = date,
                    )
                )
                if (rowId != -1L) enqueued++
            }
        }

        if (maxDate > watermark) {
            prefs.setInboxWatermarkMs(maxDate)
        }

        return InboxScanResult(examined = examined, enqueued = enqueued)
    }
}
