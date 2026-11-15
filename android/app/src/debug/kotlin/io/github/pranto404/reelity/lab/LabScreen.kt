package io.github.pranto404.reelity.lab

import android.os.Build
import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.pranto404.reelity.R
import io.github.pranto404.reelity.core.detect.IdCoverageDetector
import io.github.pranto404.reelity.core.detect.TargetApps
import kotlinx.coroutines.delay

@Composable
fun LabScreen(
    resumes: Int,
    serviceEnabled: () -> Boolean,
    onTurnOn: () -> Unit,
    onOpenAppInfo: () -> Unit,
) {
    val context = LocalContext.current
    // Ticks once a second so "s ago" and the 10-second counters stay current.
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = SystemClock.elapsedRealtime()
        }
    }
    val enabled = remember(resumes, LabState.serviceConnected) { serviceEnabled() }
    var confirmDelete by remember { mutableStateOf(false) }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.lab_title),
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(stringResource(R.string.lab_test_build), style = MaterialTheme.typography.bodyMedium)

            LabCard(stringResource(R.string.lab_status_title)) {
                val status = when {
                    LabState.serviceConnected -> R.string.lab_status_running
                    enabled -> R.string.lab_status_enabled_not_running
                    else -> R.string.lab_status_off
                }
                Text(stringResource(status), style = MaterialTheme.typography.bodyLarge)
                if (!LabState.serviceConnected) {
                    Button(onClick = onTurnOn, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.lab_turn_on))
                    }
                }
            }

            if (!LabState.serviceConnected && Build.VERSION.SDK_INT >= 33) {
                LabCard(stringResource(R.string.lab_restricted_title)) {
                    Text(stringResource(R.string.lab_restricted_body), style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = onOpenAppInfo, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.lab_open_app_info))
                    }
                }
            }

            // Advanced Protection exists from Android 16; Android 17 also blocks Accessibility for apps that are
            // not accessibility tools. We do not query it (that needs a permission), we only explain it.
            if (!LabState.serviceConnected && Build.VERSION.SDK_INT >= 36) {
                LabCard(stringResource(R.string.lab_aapm_title)) {
                    Text(stringResource(R.string.lab_aapm_body), style = MaterialTheme.typography.bodyMedium)
                }
            }

            LabCard(stringResource(R.string.lab_live_title)) {
                val pkg = LabState.lastPackage
                if (pkg == null) {
                    Text(stringResource(R.string.lab_live_none), style = MaterialTheme.typography.bodyMedium)
                } else {
                    Text(stringResource(R.string.lab_live_app, Captures.appName(pkg)), style = MaterialTheme.typography.bodyLarge)
                }
                val snapshot = LabState.latest
                if (snapshot == null) {
                    Text(stringResource(R.string.lab_no_snapshot), style = MaterialTheme.typography.bodyMedium)
                } else {
                    val nodes = remember(snapshot) { snapshot.root.walk().toList() }
                    val agoSec = ((now - LabState.latestAtElapsed) / 1000).coerceAtLeast(0).toInt()
                    Text(
                        stringResource(R.string.lab_live_snapshot, agoSec, nodes.size, nodes.count { it.id != null }),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    val guess = remember(snapshot) { IdCoverageDetector().detect(snapshot).onReel }
                    Text(
                        stringResource(
                            R.string.lab_live_guess,
                            stringResource(if (guess) R.string.lab_guess_reel else R.string.lab_guess_not_reel),
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                // Keyed on the event counter and the clock, so new events and the 10-second window both update it.
                val inputs = remember(LabState.activity, now) { LabState.recentInputs() }
                val contentChanges = remember(LabState.activity, now) { LabState.recentContentChanges() }
                Text(
                    stringResource(
                        R.string.lab_live_inputs,
                        inputs.count { it.type == "scroll" },
                        inputs.count { it.type == "click" },
                        contentChanges,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.lab_overlay_switch),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Switch(checked = LabState.overlayEnabled, onCheckedChange = { LabState.overlayEnabled = it })
            }

            val canLabel = LabState.latest != null
            Button(
                onClick = { Captures.save(context, Captures.REEL, LabState.latest) },
                enabled = canLabel,
                modifier = Modifier.fillMaxWidth().height(64.dp),
            ) {
                Text(stringResource(R.string.lab_label_reel), style = MaterialTheme.typography.titleMedium)
            }
            Button(
                onClick = { Captures.save(context, Captures.NOT_REEL, LabState.latest) },
                enabled = canLabel,
                modifier = Modifier.fillMaxWidth().height(64.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.secondary,
                    contentColor = MaterialTheme.colorScheme.onSecondary,
                ),
            ) {
                Text(stringResource(R.string.lab_label_not_reel), style = MaterialTheme.typography.titleMedium)
            }
            Text(stringResource(R.string.lab_label_hint), style = MaterialTheme.typography.bodySmall)

            LabCard(stringResource(R.string.lab_captures_title)) {
                val counts = LabState.captureCounts
                if (counts.isEmpty()) {
                    Text(stringResource(R.string.lab_captures_none), style = MaterialTheme.typography.bodyMedium)
                }
                // Installed target apps first, so the owner sees which ones still need captures.
                val packages = remember(resumes, counts) {
                    (TargetApps.packages.keys.filter { Captures.isInstalled(context, it) } + counts.keys).distinct()
                }
                for (p in packages) {
                    val c = counts[p] ?: IntArray(2)
                    Text(
                        stringResource(R.string.lab_captures_row, Captures.appName(p), c[0], c[1]),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Button(
                    onClick = { Captures.export(context) },
                    enabled = counts.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.lab_export))
                }
                OutlinedButton(
                    onClick = { confirmDelete = true },
                    enabled = counts.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.lab_delete))
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(stringResource(R.string.lab_delete_confirm_title)) },
            text = { Text(stringResource(R.string.lab_delete_confirm_body)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    Captures.deleteAll(context)
                }) { Text(stringResource(R.string.lab_delete_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.lab_cancel)) }
            },
        )
    }
}

@Composable
private fun LabCard(title: String, content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}
