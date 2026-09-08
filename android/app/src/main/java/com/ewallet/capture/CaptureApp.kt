package com.ewallet.capture

import android.app.Application
import androidx.work.WorkManager
import com.ewallet.capture.data.worker.HeartbeatWorker
import com.ewallet.capture.util.WorkScheduler

class CaptureApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Replace legacy 15-minute periodic heartbeat (false offline vs 5m server window).
        WorkManager.getInstance(this).cancelUniqueWork(HeartbeatWorker.UNIQUE_NAME)
        WorkScheduler.ensurePeriodicSync(this)
        WorkScheduler.scheduleHeartbeat(this, 0)
    }
}
