package com.ewallet.capture.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [PendingSmsEntity::class], version = 1, exportSchema = false)
abstract class CaptureDatabase : RoomDatabase() {
    abstract fun pendingSmsDao(): PendingSmsDao

    companion object {
        @Volatile private var instance: CaptureDatabase? = null

        fun get(context: Context): CaptureDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    CaptureDatabase::class.java,
                    "ewallet_capture.db"
                ).build().also { instance = it }
            }
    }
}
