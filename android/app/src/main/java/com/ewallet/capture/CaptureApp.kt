package com.ewallet.capture

import android.app.Application
import androidx.work.WorkManager
import com.ewallet.capture.data.worker.HeartbeatWorker
import com.ewallet.capture.util.Prefs
import com.ewallet.capture.util.WorkScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CaptureApp : Application() {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        val prefs = Prefs(this)
        prefs.applyManagedConfigIfNeeded()
        appScope.launch {
            prefs.ensureMigrated()
            // If MDM pushed a key before lock, probe will happen from UI / workers
        }
        WorkManager.getInstance(this).cancelUniqueWork(HeartbeatWorker.UNIQUE_NAME)
        WorkScheduler.ensurePeriodicSync(this)
        WorkScheduler.scheduleHeartbeat(this, 0)
    }
}
