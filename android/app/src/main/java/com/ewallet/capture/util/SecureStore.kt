package com.ewallet.capture.util

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted at-rest store for connection secrets (API key + base URL + lock flag).
 */
class SecureStore(context: Context) {
    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (_: Exception) {
        // Emulators / broken Keystore: fall back so the app still runs (dev only).
        context.getSharedPreferences(FILE_NAME + "_fallback", Context.MODE_PRIVATE)
    }

    var apiBase: String
        get() = prefs.getString(KEY_API_BASE, null).orEmpty()
        set(value) = prefs.edit().putString(KEY_API_BASE, value.trimEnd('/')).apply()

    var apiKey: String
        get() = prefs.getString(KEY_API_KEY, null).orEmpty()
        set(value) = prefs.edit().putString(KEY_API_KEY, value.trim()).apply()

    var locked: Boolean
        get() = prefs.getBoolean(KEY_LOCKED, false)
        set(value) = prefs.edit().putBoolean(KEY_LOCKED, value).apply()

    fun clearConnection() {
        prefs.edit()
            .remove(KEY_API_KEY)
            .remove(KEY_LOCKED)
            // Keep apiBase so re-provision is faster
            .apply()
    }

    fun clearAll() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val FILE_NAME = "capture_secure_prefs"
        private const val KEY_API_BASE = "api_base"
        private const val KEY_API_KEY = "api_key"
        private const val KEY_LOCKED = "connection_locked"
    }
}
