package com.ewallet.capture.util

import android.content.Context
import android.content.RestrictionsManager
import com.ewallet.capture.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore

private val Context.dataStore by preferencesDataStore("capture_prefs")

object PrefKeys {
    val DEVICE_NAME = stringPreferencesKey("device_name")
    val WALLET_LABEL = stringPreferencesKey("wallet_label")
    val WALLET_MSISDN = stringPreferencesKey("wallet_msisdn")
    val LAST_SYNC_MS = longPreferencesKey("last_sync_ms")
    val LAST_HEARTBEAT_MS = longPreferencesKey("last_heartbeat_ms")
    val LAST_ERROR = stringPreferencesKey("last_error")
    val LAST_ERROR_MS = longPreferencesKey("last_error_ms")
    val OFFLINE_AFTER_MINUTES = longPreferencesKey("offline_after_minutes")
    val INBOX_WATERMARK_MS = longPreferencesKey("inbox_watermark_ms")
    val CATCHUP_POLICY_V = longPreferencesKey("catchup_policy_v")
    val SENDER_IDS = stringPreferencesKey("sender_ids")
    // Legacy plaintext keys — migrated once into SecureStore then removed
    val LEGACY_API_BASE = stringPreferencesKey("api_base")
    val LEGACY_API_KEY = stringPreferencesKey("api_key")
}

class Prefs(private val context: Context) {
    private val secure = SecureStore(context)
    private val connectionTick = MutableStateFlow(0)

    init {
        migrateLegacyIfNeeded()
        applyManagedConfigIfNeeded()
    }

    private fun bump() {
        connectionTick.value = connectionTick.value + 1
    }

    private fun migrateLegacyIfNeeded() {
        // One-shot: pull old DataStore secrets into encrypted store
        // Runs blocking on first Prefs construction via runBlocking-free snapshot:
        // DataStore has no sync API; migration happens on first coroutine collect.
    }

    suspend fun ensureMigrated() {
        context.dataStore.edit { prefs ->
            val legacyKey = prefs[PrefKeys.LEGACY_API_KEY]
            val legacyBase = prefs[PrefKeys.LEGACY_API_BASE]
            if (!legacyKey.isNullOrBlank() && secure.apiKey.isBlank()) {
                secure.apiKey = legacyKey
                if (!legacyBase.isNullOrBlank()) secure.apiBase = legacyBase
                // Existing installs that already worked count as locked
                secure.locked = true
            }
            prefs.remove(PrefKeys.LEGACY_API_KEY)
            prefs.remove(PrefKeys.LEGACY_API_BASE)
        }
        bump()
    }

    /**
     * MDM / Android Enterprise managed configuration.
     * Keys: api_base, api_key (applied only when not yet locked).
     */
    fun applyManagedConfigIfNeeded() {
        if (secure.locked && secure.apiKey.isNotBlank()) return
        val rm = context.getSystemService(Context.RESTRICTIONS_SERVICE) as? RestrictionsManager
            ?: return
        val bundle = rm.applicationRestrictions ?: return
        val key = bundle.getString("api_key").orEmpty().trim()
        val base = bundle.getString("api_base").orEmpty().trimEnd('/')
        if (key.isBlank()) return
        secure.apiKey = key
        if (base.isNotBlank()) secure.apiBase = base
        bump()
    }

    val apiBase: Flow<String> = connectionTick.map {
        secure.apiBase.ifBlank { BuildConfig.DEFAULT_API_BASE }
    }
    val apiKey: Flow<String> = connectionTick.map { secure.apiKey }
    val connectionLocked: Flow<Boolean> = connectionTick.map {
        secure.locked && secure.apiKey.isNotBlank()
    }

    fun peekApiBase(): String = secure.apiBase.ifBlank { BuildConfig.DEFAULT_API_BASE }
    fun peekApiKey(): String = secure.apiKey
    fun peekLocked(): Boolean = secure.locked && secure.apiKey.isNotBlank()

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

    /** Save credentials; does not lock until [lockConnection] after successful probe. */
    fun saveConnection(apiBase: String, apiKey: String) {
        val base = apiBase.trimEnd('/').ifBlank { BuildConfig.DEFAULT_API_BASE }
        secure.apiBase = base
        secure.apiKey = apiKey.trim()
        bump()
    }

    fun lockConnection() {
        if (secure.apiKey.isNotBlank()) {
            secure.locked = true
            bump()
        }
    }

    /** Wipe key + lock; keeps default/base URL. Clears device meta. */
    suspend fun resetConnection() {
        secure.clearConnection()
        context.dataStore.edit {
            it.remove(PrefKeys.DEVICE_NAME)
            it.remove(PrefKeys.WALLET_LABEL)
            it.remove(PrefKeys.WALLET_MSISDN)
        }
        bump()
    }

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

    /**
     * One-shot upgrade: drop any queued historical SMS and start the inbox
     * watermark at "now" so Sync no longer re-uploads old inbox messages.
     * @return true if the purge ran this call
     */
    suspend fun applyCatchupPolicyV3IfNeeded(purgeQueue: suspend () -> Unit): Boolean {
        val current = context.dataStore.data.map { it[PrefKeys.CATCHUP_POLICY_V] ?: 0L }.first()
        if (current >= CATCHUP_POLICY_VERSION) return false
        purgeQueue()
        context.dataStore.edit {
            it[PrefKeys.INBOX_WATERMARK_MS] = System.currentTimeMillis()
            it[PrefKeys.CATCHUP_POLICY_V] = CATCHUP_POLICY_VERSION
        }
        return true
    }

    companion object {
        const val CATCHUP_POLICY_VERSION = 3L

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
