package com.ewallet.capture.data.inbox

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
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
)

/**
 * Backfills allowlisted SMS from the device inbox using the same idempotency
 * keys as the live broadcast path so duplicates are harmless.
 */
object InboxScanner {
    private const val LOOKBACK_MS = 7L * 24 * 60 * 60 * 1000
    private const val MAX_ROWS = 200

    suspend fun scanAndEnqueue(context: Context): InboxScanResult {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return InboxScanResult()
        }

        val prefs = Prefs(context)
        val allowed = prefs.senderIds.first()
        if (allowed.isEmpty()) return InboxScanResult()

        val watermark = prefs.inboxWatermarkMs.first()
        val floor = maxOf(
            watermark,
            System.currentTimeMillis() - LOOKBACK_MS
        )

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

        // Advance watermark even if nothing matched so we don't re-scan forever.
        if (maxDate > watermark) {
            prefs.setInboxWatermarkMs(maxDate)
        }

        return InboxScanResult(examined = examined, enqueued = enqueued)
    }
}
