package com.ewallet.capture.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.ewallet.capture.BuildConfig
import com.ewallet.capture.data.api.CaptureApiClient
import com.ewallet.capture.data.db.CaptureDatabase
import com.ewallet.capture.data.inbox.InboxScanner
import com.ewallet.capture.data.worker.SyncWorker
import com.ewallet.capture.ui.theme.CaptureColors
import com.ewallet.capture.ui.theme.CaptureTheme
import com.ewallet.capture.util.Prefs
import com.ewallet.capture.util.WorkScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val smsOk = grants[Manifest.permission.RECEIVE_SMS] == true ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) ==
            PackageManager.PERMISSION_GRANTED
        if (smsOk) {
            lifecycleScope.launch(Dispatchers.IO) {
                InboxScanner.scanAndEnqueue(this@MainActivity)
                WorkScheduler.enqueueSyncNow(this@MainActivity)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestSmsPermissionsIfNeeded()

        setContent {
            CaptureTheme {
                StatusScreen(
                    onSave = { base, key, onResult ->
                        lifecycleScope.launch {
                            val prefs = Prefs(this@MainActivity)
                            prefs.saveConnection(base, key)
                            val result = withContext(Dispatchers.IO) {
                                probeConnection(base.trimEnd('/'), key.trim())
                            }
                            if (result.ok) {
                                WorkScheduler.enqueueHeartbeatAndSync(this@MainActivity)
                            }
                            onResult(result)
                        }
                    },
                    onSyncNow = {
                        lifecycleScope.launch(Dispatchers.IO) {
                            InboxScanner.scanAndEnqueue(this@MainActivity)
                        }
                        WorkScheduler.enqueueHeartbeatAndSync(this)
                    },
                    onRequestPermissions = { requestSmsPermissionsIfNeeded(force = true) },
                    onOpenAppSettings = {
                        startActivity(
                            Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", packageName, null)
                            )
                        )
                    }
                )
            }
        }
    }

    private fun requestSmsPermissionsIfNeeded(force: Boolean = false) {
        val needed = mutableListOf(
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
        )
        if (Build.VERSION.SDK_INT >= 33) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty() || force) {
            permissionLauncher.launch((if (force) needed else missing).toTypedArray())
        }
    }

    companion object {
        data class ProbeResult(val ok: Boolean, val message: String)

        fun probeConnection(base: String, key: String): ProbeResult {
            if (base.isBlank() || key.isBlank()) {
                return ProbeResult(false, "API URL and device key are required")
            }
            return try {
                val client = CaptureApiClient(base, key)
                val hb = client.heartbeat()
                if (!hb.ok) {
                    return ProbeResult(false, "Heartbeat failed HTTP ${hb.httpCode}")
                }
                val (code, cfg) = client.fetchConfig()
                if (cfg == null) {
                    return ProbeResult(false, "Config failed HTTP $code")
                }
                val name = cfg.optString("deviceName").ifBlank { "device" }
                ProbeResult(true, "Connected as $name")
            } catch (e: Exception) {
                ProbeResult(false, e.message ?: "Connection failed")
            }
        }
    }
}

private enum class HealthState { Ready, Attention, Setup }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatusScreen(
    onSave: (String, String, (MainActivity.Companion.ProbeResult) -> Unit) -> Unit,
    onSyncNow: () -> Unit,
    onRequestPermissions: () -> Unit,
    onOpenAppSettings: () -> Unit,
) {
    val context = LocalContext.current
    val prefs = remember { Prefs(context) }
    val dao = remember { CaptureDatabase.get(context).pendingSmsDao() }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val apiBase by prefs.apiBase.collectAsState(initial = "http://10.0.2.2:3001")
    val apiKey by prefs.apiKey.collectAsState(initial = "")
    val deviceName by prefs.deviceName.collectAsState(initial = "")
    val walletLabel by prefs.walletLabel.collectAsState(initial = "")
    val walletMsisdn by prefs.walletMsisdn.collectAsState(initial = "")
    val lastSyncMs by prefs.lastSyncMs.collectAsState(initial = 0L)
    val lastHeartbeatMs by prefs.lastHeartbeatMs.collectAsState(initial = 0L)
    val lastError by prefs.lastError.collectAsState(initial = "")
    val lastErrorMs by prefs.lastErrorMs.collectAsState(initial = 0L)
    val offlineAfter by prefs.offlineAfterMinutes.collectAsState(initial = 5L)
    val senderIds by prefs.senderIds.collectAsState(initial = Prefs.defaultSenderIds())

    var queueSize by remember { mutableIntStateOf(0) }
    var deadCount by remember { mutableIntStateOf(0) }
    var oldestPendingMs by remember { mutableStateOf<Long?>(null) }
    var connecting by remember { mutableStateOf(false) }
    var showKey by remember { mutableStateOf(false) }
    var permissionTick by remember { mutableIntStateOf(0) }
    var settingsOpen by remember { mutableStateOf(false) }
    var editingConnection by remember { mutableStateOf(false) }

    val smsGranted = remember(permissionTick) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) ==
            PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED
    }

    val configured = apiKey.isNotBlank() && deviceName.isNotBlank()
    val heartbeatFresh = lastHeartbeatMs > 0L &&
        System.currentTimeMillis() - lastHeartbeatMs < offlineAfter * 60_000L
    val linkOk = configured && heartbeatFresh && lastError.isBlank()

    val health = when {
        !smsGranted || apiKey.isBlank() || deviceName.isBlank() -> HealthState.Setup
        !linkOk || deadCount > 0 || lastError.isNotBlank() -> HealthState.Attention
        else -> HealthState.Ready
    }

    LaunchedEffect(configured) {
        if (!configured) {
            settingsOpen = true
            editingConnection = true
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            queueSize = dao.countPending(SyncWorker.MAX_ATTEMPTS)
            deadCount = dao.countDead(SyncWorker.MAX_ATTEMPTS)
            oldestPendingMs = dao.oldestPendingMs(SyncWorker.MAX_ATTEMPTS)
            permissionTick++
            kotlinx.coroutines.delay(2_000)
        }
    }

    var draftBase by remember { mutableStateOf(apiBase) }
    var draftKey by remember { mutableStateOf(apiKey) }
    LaunchedEffect(apiBase, apiKey) {
        draftBase = apiBase
        draftKey = apiKey
    }

    fun fmt(ms: Long): String =
        if (ms <= 0L) "Never" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
            .format(Date(ms))

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = {
            SnackbarHost(
                hostState = snackbar,
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(12.dp)
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "E-Wallet Capture",
                        style = MaterialTheme.typography.headlineLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        "Company handset · deposit SMS sync",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    "v${BuildConfig.VERSION_NAME}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            HealthBanner(health = health, deviceName = deviceName)

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                StatusChip(
                    label = if (smsGranted) "SMS OK" else "SMS needed",
                    ok = smsGranted
                )
                StatusChip(
                    label = when {
                        !configured -> "Not linked"
                        linkOk -> "Online"
                        else -> "Offline"
                    },
                    ok = linkOk
                )
                StatusChip(
                    label = if (queueSize == 0) "Queue clear" else "Queue $queueSize",
                    ok = queueSize == 0 && deadCount == 0,
                    warn = queueSize > 0 || deadCount > 0
                )
            }

            if (!smsGranted) {
                Panel {
                    Text(
                        "SMS permission required",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        "This phone must read e-wallet deposit messages for the company SIM.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onRequestPermissions) { Text("Grant SMS") }
                        OutlinedButton(onClick = onOpenAppSettings) { Text("Settings") }
                    }
                }
            }

            Panel {
                Text("This device", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(10.dp))
                MetaRow("Name", deviceName.ifBlank { "Not connected" })
                MetaRow("Wallet", walletLabel.ifBlank { "—" })
                MetaRow(
                    "MSISDN",
                    walletMsisdn.ifBlank { "—" },
                    mono = true
                )
                MetaRow("Last sync", fmt(lastSyncMs))
                MetaRow("Last heartbeat", fmt(lastHeartbeatMs))
                if (oldestPendingMs != null) {
                    MetaRow("Oldest pending", fmt(oldestPendingMs!!))
                }
                if (deadCount > 0) {
                    MetaRow("Failed messages", "$deadCount (stopped retrying)")
                }
            }

            if (lastError.isNotBlank()) {
                Panel(tone = PanelTone.Danger) {
                    Text("Last error", style = MaterialTheme.typography.titleMedium)
                    Text(
                        fmt(lastErrorMs),
                        style = MaterialTheme.typography.labelMedium,
                        color = CaptureColors.Danger
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(lastError, style = MaterialTheme.typography.bodyMedium)
                }
            }

            Panel {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Connection", style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (configured && !editingConnection) {
                                "Linked · tap Edit to change URL or key"
                            } else {
                                "API base URL and device key"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    TextButton(
                        onClick = {
                            if (configured && !settingsOpen) {
                                settingsOpen = true
                            } else if (configured && settingsOpen && !editingConnection) {
                                editingConnection = true
                            } else if (configured && editingConnection) {
                                editingConnection = false
                                draftBase = apiBase
                                draftKey = apiKey
                                settingsOpen = false
                            } else {
                                settingsOpen = !settingsOpen
                            }
                        }
                    ) {
                        Text(
                            when {
                                configured && !settingsOpen -> "Show"
                                configured && settingsOpen && !editingConnection -> "Edit"
                                configured && editingConnection -> "Cancel"
                                settingsOpen -> "Hide"
                                else -> "Show"
                            }
                        )
                    }
                }

                AnimatedVisibility(visible = settingsOpen || !configured) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Spacer(Modifier.height(4.dp))
                        if (!editingConnection && configured) {
                            MetaRow("API", apiBase, mono = true)
                            MetaRow(
                                "Key",
                                if (apiKey.length <= 8) "••••••••" else "••••${apiKey.takeLast(4)}"
                            )
                            MetaRow(
                                "Senders",
                                senderIds.sorted().take(6).joinToString(", ") +
                                    if (senderIds.size > 6) "…" else ""
                            )
                        } else {
                            OutlinedTextField(
                                value = draftBase,
                                onValueChange = { draftBase = it },
                                label = { Text("API base URL") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                shape = RoundedCornerShape(12.dp)
                            )
                            OutlinedTextField(
                                value = draftKey,
                                onValueChange = { draftKey = it },
                                label = { Text("Device API key") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                shape = RoundedCornerShape(12.dp),
                                visualTransformation = if (showKey) {
                                    VisualTransformation.None
                                } else {
                                    PasswordVisualTransformation()
                                },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                trailingIcon = {
                                    TextButton(onClick = { showKey = !showKey }) {
                                        Text(if (showKey) "Hide" else "Show")
                                    }
                                }
                            )
                            Button(
                                enabled = !connecting,
                                onClick = {
                                    connecting = true
                                    onSave(draftBase, draftKey) { result ->
                                        connecting = false
                                        scope.launch {
                                            snackbar.showSnackbar(result.message)
                                            if (result.ok) {
                                                editingConnection = false
                                                settingsOpen = false
                                                val p = Prefs(context)
                                                withContext(Dispatchers.IO) {
                                                    applyProbeMeta(p, draftBase, draftKey)
                                                }
                                            } else {
                                                Prefs(context).setLastError(result.message)
                                            }
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (connecting) "Connecting…" else "Save & connect")
                            }
                        }
                    }
                }
            }

            Button(
                onClick = {
                    onSyncNow()
                    scope.launch { snackbar.showSnackbar("Sync and heartbeat queued") }
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary
                )
            ) {
                Text("Sync now")
            }

            Text(
                "Device key only — staff use the web dashboard. No personal login on this phone.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(8.dp))
        }
    }
}

private suspend fun applyProbeMeta(prefs: Prefs, base: String, key: String) {
    val client = CaptureApiClient(base.trimEnd('/'), key.trim())
    val hb = client.heartbeat()
    if (hb.ok) {
        prefs.setLastHeartbeat(System.currentTimeMillis(), hb.offlineAfterMinutes)
    }
    val (_, cfg) = client.fetchConfig()
    if (cfg != null) {
        val wallet = cfg.optJSONObject("walletNumber")
        val arr = cfg.optJSONArray("senderIds")
        val ids = mutableListOf<String>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val entry = arr.getJSONObject(i)
                val s = entry.optJSONArray("senderIds") ?: continue
                for (j in 0 until s.length()) ids.add(s.getString(j).lowercase())
            }
        }
        prefs.saveDeviceMeta(
            name = cfg.optString("deviceName"),
            label = wallet?.optString("label").orEmpty(),
            msisdn = wallet?.optString("msisdn").orEmpty(),
            senderIdsCsv = ids.distinct().joinToString(","),
        )
        prefs.clearLastError()
    }
}

@Composable
private fun HealthBanner(health: HealthState, deviceName: String) {
    val (title, subtitle, bg, fg) = when (health) {
        HealthState.Ready -> Quad(
            "Ready",
            if (deviceName.isNotBlank()) "Capturing as $deviceName" else "Capture active",
            CaptureColors.OkSoft,
            CaptureColors.Ok
        )
        HealthState.Attention -> Quad(
            "Needs attention",
            "Check link, errors, or failed queue items",
            CaptureColors.WarnSoft,
            CaptureColors.Warn
        )
        HealthState.Setup -> Quad(
            "Setup required",
            "Grant SMS and connect with a device API key",
            CaptureColors.DangerSoft,
            CaptureColors.Danger
        )
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .padding(horizontal = 18.dp, vertical = 16.dp)
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium, color = fg)
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = fg.copy(alpha = 0.85f))
    }
}

private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

@Composable
private fun StatusChip(label: String, ok: Boolean, warn: Boolean = false) {
    val bg = when {
        ok -> CaptureColors.OkSoft
        warn -> CaptureColors.WarnSoft
        else -> CaptureColors.DangerSoft
    }
    val fg = when {
        ok -> CaptureColors.Ok
        warn -> CaptureColors.Warn
        else -> CaptureColors.Danger
    }
    Text(
        text = label,
        style = MaterialTheme.typography.labelLarge,
        color = fg,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .padding(horizontal = 12.dp, vertical = 7.dp)
    )
}

private enum class PanelTone { Neutral, Danger }

@Composable
private fun Panel(tone: PanelTone = PanelTone.Neutral, content: @Composable () -> Unit) {
    val bg = when (tone) {
        PanelTone.Neutral -> MaterialTheme.colorScheme.surface
        PanelTone.Danger -> CaptureColors.DangerSoft
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = bg,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp
    ) {
        Column(modifier = Modifier.padding(16.dp), content = { content() })
    }
}

@Composable
private fun MetaRow(label: String, value: String, mono: Boolean = false) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(118.dp)
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontFamily = if (mono) FontFamily.Monospace else FontFamily.SansSerif
            ),
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f)
        )
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
}
