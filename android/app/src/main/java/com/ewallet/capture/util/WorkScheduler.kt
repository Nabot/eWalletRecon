package com.ewallet.capture.util

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.ewallet.capture.data.worker.HeartbeatWorker
import com.ewallet.capture.data.worker.SyncWorker
import java.util.concurrent.TimeUnit

object WorkScheduler {
    /** Backend marks devices offline after 5 minutes; stay well under that. */
    const val HEARTBEAT_INTERVAL_MINUTES = 3L

    private fun networkConstraints(): Constraints =
        Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

    fun ensurePeriodicSync(context: Context) {
        val sync = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            SyncWorker.UNIQUE_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            sync
        )
    }

    /** Immediate unique sync; KEEP avoids stacking parallel workers. */
    fun enqueueSyncNow(context: Context) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(networkConstraints())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            SyncWorker.UNIQUE_ONESHOT,
            ExistingWorkPolicy.KEEP,
            req
        )
    }

    /**
     * Schedule a heartbeat. delayMinutes=0 runs ASAP then the worker re-chains
     * every [HEARTBEAT_INTERVAL_MINUTES].
     */
    fun scheduleHeartbeat(context: Context, delayMinutes: Long = 0L) {
        val builder = OneTimeWorkRequestBuilder<HeartbeatWorker>()
            .setConstraints(networkConstraints())
        if (delayMinutes > 0) {
            builder.setInitialDelay(delayMinutes, TimeUnit.MINUTES)
        }
        WorkManager.getInstance(context).enqueueUniqueWork(
            HeartbeatWorker.UNIQUE_ONESHOT,
            ExistingWorkPolicy.REPLACE,
            builder.build()
        )
    }

    fun enqueueHeartbeatAndSync(context: Context) {
        scheduleHeartbeat(context, 0)
        enqueueSyncNow(context)
    }
}
