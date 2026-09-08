package com.ewallet.capture.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PendingSmsDao {
    /** @return row id, or -1 if ignored as duplicate. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: PendingSmsEntity): Long

    @Query(
        "SELECT * FROM pending_sms WHERE syncAttempts < :maxAttempts " +
            "ORDER BY receivedAtEpochMs ASC LIMIT :limit"
    )
    suspend fun peek(limit: Int = 50, maxAttempts: Int = 8): List<PendingSmsEntity>

    @Query("DELETE FROM pending_sms WHERE idempotencyKey IN (:keys)")
    suspend fun deleteKeys(keys: List<String>)

    @Query("SELECT COUNT(*) FROM pending_sms WHERE syncAttempts < :maxAttempts")
    suspend fun countPending(maxAttempts: Int = 8): Int

    @Query("SELECT COUNT(*) FROM pending_sms WHERE syncAttempts >= :maxAttempts")
    suspend fun countDead(maxAttempts: Int = 8): Int

    @Query("SELECT MIN(receivedAtEpochMs) FROM pending_sms WHERE syncAttempts < :maxAttempts")
    suspend fun oldestPendingMs(maxAttempts: Int = 8): Long?

    @Query("UPDATE pending_sms SET syncAttempts = syncAttempts + 1 WHERE idempotencyKey IN (:keys)")
    suspend fun bumpAttempts(keys: List<String>)

    @Query("DELETE FROM pending_sms WHERE syncAttempts >= :maxAttempts")
    suspend fun purgeDead(maxAttempts: Int = 8): Int
}
