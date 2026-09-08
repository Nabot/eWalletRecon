package com.ewallet.capture.data.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.ewallet.capture.util.WorkScheduler

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        WorkScheduler.ensurePeriodicSync(context)
        WorkScheduler.enqueueHeartbeatAndSync(context)
    }
}
