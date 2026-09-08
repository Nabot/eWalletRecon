package com.ewallet.capture.util

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("capture_prefs")

object PrefKeys {
    val API_BASE = stringPreferencesKey("api_base")
    val API_KEY = stringPreferencesKey("api_key")
    val DEVICE_NAME = stringPreferencesKey("device_name")
    val WALLET_LABEL = stringPreferencesKey("wallet_label")
    val WALLET_MSISDN = stringPreferencesKey("wallet_msisdn")
    val LAST_SYNC_MS = longPreferencesKey("last_sync_ms")
    val LAST_HEARTBEAT_MS = longPreferencesKey("last_heartbeat_ms")
    val LAST_ERROR = stringPreferencesKey("last_error")
    val LAST_ERROR_MS = longPreferencesKey("last_error_ms")
    val OFFLINE_AFTER_MINUTES = longPreferencesKey("offline_after_minutes")
    val INBOX_WATERMARK_MS = longPreferencesKey("inbox_watermark_ms")
    val SENDER_IDS = stringPreferencesKey("sender_ids") // comma-separated, lowercase
}

class Prefs(private val context: Context) {
    val apiBase: Flow<String> = context.dataStore.data.map {
        it[PrefKeys.API_BASE] ?: "http://10.0.2.2:3001"
    }
    val apiKey: Flow<String> = context.dataStore.data.map { it[PrefKeys.API_KEY] ?: "" }
    val deviceName: Flow<String> = context.dataStore.data.map { it[PrefKeys.DEVICE_NAME] ?: "" }
    val walletLabel: Flow<String> = context.dataStore.data.map { it[PrefKeys.WALLET_LABEL] ?: "" }
    val walletMsisdn: Flow<String> = context.dataStore.data.map { it[PrefKeys.WALLET_MSISDN] ?: "" }
    val lastSyncMs: Flow<Long> = context.dataStore.data.map { it[PrefKeys.LAST_SYNC_MS] ?: 0L }
    val lastHeartbeatMs: Flow<Long> = context.dataStore.data.map { it[PrefKeys.LAST_HEARTBEAT_MS] ?: 0L }
    val lastError: Flow<String> = context.dataStore.data.map { it[PrefKeys.LAST_ERROR] ?: "" }
    val lastErrorMs: Flow<Long> = context.dataStore.data.map { it[PrefKeys.LAST_ERROR_MS] ?: 0L }
    val offlineAfterMinutes: Flow<Long> = context.dataStore.data.map {
        it[PrefKeys.OFFLINE_AFTER_MINUTES] ?: 5L
    }
    val inboxWatermarkMs: Flow<Long> = context.dataStore.data.map {
        it[PrefKeys.INBOX_WATERMARK_MS] ?: 0L
    }
    val senderIds: Flow<Set<String>> = context.dataStore.data.map { prefs ->
        val stored = prefs[PrefKeys.SENDER_IDS]
            ?.split(",")
            ?.map { it.trim().lowercase() }
            ?.filter { it.isNotEmpty() }
            ?.toSet()
            .orEmpty()
        if (stored.isEmpty()) defaultSenderIds() else stored
    }

    suspend fun saveConnection(apiBase: String, apiKey: String) {
        context.dataStore.edit {
            it[PrefKeys.API_BASE] = apiBase.trimEnd('/')
            it[PrefKeys.API_KEY] = apiKey.trim()
        }
    }

    /**
     * Persists device meta from /config. Empty sender lists are ignored so a
     * bad payload cannot disable capture.
     */
    suspend fun saveDeviceMeta(name: String, label: String, msisdn: String, senderIdsCsv: String) {
        val cleaned = senderIdsCsv
            .split(",")
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .distinct()
        context.dataStore.edit {
            it[PrefKeys.DEVICE_NAME] = name
            it[PrefKeys.WALLET_LABEL] = label
            it[PrefKeys.WALLET_MSISDN] = msisdn
            if (cleaned.isNotEmpty()) {
                it[PrefKeys.SENDER_IDS] = cleaned.joinToString(",")
            }
        }
    }

    suspend fun setLastSync(ms: Long) {
        context.dataStore.edit { it[PrefKeys.LAST_SYNC_MS] = ms }
    }

    suspend fun setLastHeartbeat(ms: Long, offlineAfterMinutes: Long? = null) {
        context.dataStore.edit {
            it[PrefKeys.LAST_HEARTBEAT_MS] = ms
            if (offlineAfterMinutes != null && offlineAfterMinutes > 0) {
                it[PrefKeys.OFFLINE_AFTER_MINUTES] = offlineAfterMinutes
            }
        }
    }

    suspend fun setLastError(message: String) {
        context.dataStore.edit {
            it[PrefKeys.LAST_ERROR] = message.take(400)
            it[PrefKeys.LAST_ERROR_MS] = System.currentTimeMillis()
        }
    }

    suspend fun clearLastError() {
        context.dataStore.edit {
            it.remove(PrefKeys.LAST_ERROR)
            it.remove(PrefKeys.LAST_ERROR_MS)
        }
    }

    suspend fun setInboxWatermarkMs(ms: Long) {
        context.dataStore.edit { it[PrefKeys.INBOX_WATERMARK_MS] = ms }
    }

    companion object {
        /**
         * Confirmed SMS sender IDs (as shown on handset):
         * - PayPulse / BlueVoucher → PAYPULSE
         * - FNB eWallet → 362626
         * - EasyWallet → 140295
         */
        fun defaultSenderIds(): Set<String> = setOf(
            "paypulse",
            "362626",
            "140295",
            "bluevoucher",
            "easywallet",
            "pay2cell",
            "bankwhk",
            "fnbewallet",
        )
    }
}
