package io.github.pranto404.reelity.lab

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import io.github.pranto404.reelity.a11y.DetectionService
import io.github.pranto404.reelity.ui.theme.ReelityTheme

/** Debug-only screen for the M1 detection spike. Not exported: only reachable from the welcome screen. */
class DetectionLabActivity : ComponentActivity() {
    private var resumes by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ReelityTheme {
                var showDisclosure by rememberSaveable { mutableStateOf(false) }
                if (showDisclosure) {
                    DisclosureScreen(
                        onAgree = {
                            showDisclosure = false
                            openAccessibilitySettings(this)
                        },
                        onNotNow = { showDisclosure = false },
                    )
                } else {
                    LabScreen(
                        resumes = resumes,
                        serviceEnabled = { isServiceEnabled(this) },
                        onTurnOn = { showDisclosure = true },
                        onOpenAppInfo = { openAppInfo(this) },
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        resumes++
        Captures.refreshCounts(this)
    }
}

private fun serviceComponent(context: Context) = ComponentName(context, DetectionService::class.java)

/** "Enabled" = listed in Settings.Secure (readable without any permission); "running" is LabState.serviceConnected. */
internal fun isServiceEnabled(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        ?: return false
    val ours = serviceComponent(context)
    return enabled.split(':').any { ComponentName.unflattenFromString(it) == ours }
}

/**
 * Opens Settings > Accessibility. The fragment-args extras ask Settings to highlight our entry; Settings apps that
 * do not know them simply ignore them (M1 checks whether the owner's phone highlights it).
 */
internal fun openAccessibilitySettings(context: Context) {
    val key = serviceComponent(context).flattenToString()
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        .putExtra(":settings:fragment_args_key", key)
        .putExtra(":settings:show_fragment_args", Bundle().apply { putString(":settings:fragment_args_key", key) })
    try {
        context.startActivity(intent)
    } catch (e: ActivityNotFoundException) {
        context.startActivity(Intent(Settings.ACTION_SETTINGS))
    }
}

/** App info, where Android 13+ hides "Allow restricted settings" in the three-dot menu. */
internal fun openAppInfo(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
    )
}
