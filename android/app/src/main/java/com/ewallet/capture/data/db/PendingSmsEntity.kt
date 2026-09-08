package com.ewallet.capture.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_sms")
data class PendingSmsEntity(
    @PrimaryKey val idempotencyKey: String,
    val rawMessage: String,
    val senderAddress: String,
    val receivedAtEpochMs: Long,
    val createdAtEpochMs: Long = System.currentTimeMillis(),
    val syncAttempts: Int = 0,
)
