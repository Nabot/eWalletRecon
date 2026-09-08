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
import androidx.compose.material3.AlertDialog
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
import com.ewallet.capture.util.ProvisionPayload
import com.ewallet.capture.util.WorkScheduler
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    private lateinit var prefs: Prefs
    private var pendingProvisionCallback: ((ProvisionPayload) -> Unit)? = null

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

    private val qrLauncher = registerForActivityResult(ScanContract()) { result ->
        val raw = result.contents ?: return@registerForActivityResult
        val payload = ProvisionPayload.parse(raw)
        if (payload != null) {
            pendingProvisionCallback?.invoke(payload)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        enableEdgeToEdge()
        requestSmsPermissionsIfNeeded()

        lifecycleScope.launch {
            prefs.ensureMigrated()
            handleProvisionIntent(intent)
        }

        setContent {
            CaptureTheme {
                StatusScreen(
                    onSave = { base, key, onResult ->
                        lifecycleScope.launch {
                            prefs.saveConnection(base, key)
                            val result = withContext(Dispatchers.IO) {
                                probeAndBind(prefs, base.trimEnd('/'), key.trim())
                            }
                            if (result.ok) {
                                prefs.lockConnection()
                                WorkScheduler.enqueueHeartbeatAndSync(this@MainActivity)
                            }
                            onResult(result)
                        }
                    },
                    onScanQr = { onPayload ->
                        pendingProvisionCallback = onPayload
                        val options = ScanOptions()
                            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                            .setPrompt("Scan device provision QR")
                            .setBeepEnabled(false)
                            .setOrientationLocked(true)
                        options.addExtra(Intents.Scan.SCAN_TYPE, Intents.Scan.MIXED_SCAN)
                        qrLauncher.launch(options)
                    },
                    onReset = {
                        lifecycleScope.launch {
                            prefs.resetConnection()
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        lifecycleScope.launch { handleProvisionIntent(intent) }
    }

    private suspend fun handleProvisionIntent(intent: Intent?) {
        if (prefs.peekLocked()) return
        val data = intent?.data ?: return
        if (data.scheme != "ewallet-capture" || data.host != "provision") return
        val raw = data.getQueryParameter("payload")
            ?: data.getQueryParameter("p")
            ?: return
        val decoded = runCatching {
            String(android.util.Base64.decode(raw, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP))
        }.getOrElse { raw }
        val payload = ProvisionPayload.parse(decoded) ?: return
        val base = payload.apiBase.ifBlank { BuildConfig.DEFAULT_API_BASE }
        prefs.saveConnection(base, payload.apiKey)
        val result = withContext(Dispatchers.IO) { probeAndBind(prefs, base, payload.apiKey) }
        if (result.ok) {
            prefs.lockConnection()
            WorkScheduler.enqueueHeartbeatAndSync(this)
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
                ProbeResult(true, "Connected as $name · connection locked")
            } catch (e: Exception) {
                ProbeResult(false, e.message ?: "Connection failed")
            }
        }

        suspend fun probeAndBind(prefs: Prefs, base: String, key: String): ProbeResult {
            val result = probeConnection(base, key)
            if (result.ok) {
                applyProbeMeta(prefs, base, key)
            } else {
                prefs.setLastError(result.message)
            }
            return result
        }
    }
}

private enum class HealthState { Ready, Attention, Setup }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatusScreen(
    onSave: (String, String, (MainActivity.Companion.ProbeResult) -> Unit) -> Unit,
    onScanQr: ((ProvisionPayload) -> Unit) -> Unit,
    onReset: () -> Unit,
    onSyncNow: () -> Unit,
    onRequestPermissions: () -> Unit,
    onOpenAppSettings: () -> Unit,
) {
    val context = LocalContext.current
    val prefs = remember { Prefs(context) }
    val dao = remember { CaptureDatabase.get(context).pendingSmsDao() }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { prefs.ensureMigrated() }

    val apiBase by prefs.apiBase.collectAsState(initial = BuildConfig.DEFAULT_API_BASE)
    val apiKey by prefs.apiKey.collectAsState(initial = "")
    val locked by prefs.connectionLocked.collectAsState(initial = false)
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
    var showResetDialog by remember { mutableStateOf(false) }
    var resetConfirm by remember { mutableStateOf("") }

    val smsGranted = remember(permissionTick) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) ==
            PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED
    }

    val configured = locked && apiKey.isNotBlank() && deviceName.isNotBlank()
    val heartbeatFresh = lastHeartbeatMs > 0L &&
        System.currentTimeMillis() - lastHeartbeatMs < offlineAfter * 60_000L
    val linkOk = configured && heartbeatFresh && lastError.isBlank()

    val health = when {
        !smsGranted || apiKey.isBlank() || !locked -> HealthState.Setup
        !linkOk || deadCount > 0 || lastError.isNotBlank() -> HealthState.Attention
        else -> HealthState.Ready
    }

    LaunchedEffect(locked) {
        if (!locked) {
            settingsOpen = true
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
    var draftKey by remember { mutableStateOf("") }
    LaunchedEffect(apiBase, locked) {
        draftBase = apiBase
        if (locked) draftKey = ""
    }

    fun applyPayload(payload: ProvisionPayload) {
        val base = payload.apiBase.ifBlank { BuildConfig.DEFAULT_API_BASE }
        draftBase = base
        draftKey = payload.apiKey
        connecting = true
        onSave(base, payload.apiKey) { result ->
            connecting = false
            scope.launch {
                snackbar.showSnackbar(result.message)
                if (result.ok) settingsOpen = false
            }
        }
    }

    fun fmt(ms: Long): String =
        if (ms <= 0L) "Never" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
            .format(Date(ms))

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            title = { Text("Reset connection?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "This wipes the device API key. You will need a new provision QR from admin. Type RESET to confirm."
                    )
                    OutlinedTextField(
                        value = resetConfirm,
                        onValueChange = { resetConfirm = it },
                        label = { Text("Type RESET") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = resetConfirm.trim().equals("RESET", ignoreCase = true),
                    onClick = {
                        showResetDialog = false
                        resetConfirm = ""
                        onReset()
                        draftKey = ""
                        settingsOpen = true
                        scope.launch { snackbar.showSnackbar("Connection cleared — scan a new QR") }
                    }
                ) { Text("Reset") }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) { Text("Cancel") }
            }
        )
    }

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
                StatusChip(label = if (smsGranted) "SMS OK" else "SMS needed", ok = smsGranted)
                StatusChip(
                    label = when {
                        !locked -> "Not provisioned"
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
                if (locked) {
                    StatusChip(label = "Locked", ok = true)
                }
            }

            if (!smsGranted) {
                Panel {
                    Text("SMS permission required", style = MaterialTheme.typography.titleMedium)
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
                MetaRow("MSISDN", walletMsisdn.ifBlank { "—" }, mono = true)
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
                            when {
                                locked -> "Configured once · key sealed on device"
                                else -> "Scan admin QR or paste device key (once)"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (locked) {
                        TextButton(onClick = { settingsOpen = !settingsOpen }) {
                            Text(if (settingsOpen) "Hide" else "Show")
                        }
                    }
                }

                AnimatedVisibility(visible = settingsOpen || !locked) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Spacer(Modifier.height(4.dp))
                        if (locked) {
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
                            OutlinedButton(
                                onClick = {
                                    resetConfirm = ""
                                    showResetDialog = true
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Reset connection…")
                            }
                        } else {
                            if (BuildConfig.ALLOW_EDIT_API_BASE) {
                                OutlinedTextField(
                                    value = draftBase,
                                    onValueChange = { draftBase = it },
                                    label = { Text("API base URL") },
                                    modifier = Modifier.fillMaxWidth(),
                                    singleLine = true,
                                    shape = RoundedCornerShape(12.dp)
                                )
                            } else {
                                MetaRow("API", BuildConfig.DEFAULT_API_BASE, mono = true)
                            }
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
                            OutlinedButton(
                                enabled = !connecting,
                                onClick = { onScanQr { applyPayload(it) } },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Scan provision QR")
                            }
                            Button(
                                enabled = !connecting && draftKey.isNotBlank(),
                                onClick = {
                                    val base = if (BuildConfig.ALLOW_EDIT_API_BASE) {
                                        draftBase
                                    } else {
                                        BuildConfig.DEFAULT_API_BASE
                                    }
                                    connecting = true
                                    onSave(base, draftKey) { result ->
                                        connecting = false
                                        scope.launch {
                                            snackbar.showSnackbar(result.message)
                                            if (result.ok) {
                                                settingsOpen = false
                                                draftKey = ""
                                            }
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (connecting) "Connecting…" else "Save & lock")
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
                "Device key only — staff use the web dashboard. Provision once; reset only when replacing this phone.",
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
            "Grant SMS and scan the admin provision QR once",
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
