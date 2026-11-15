package io.github.pranto404.reelity

import android.content.Intent
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.pranto404.reelity.lab.DetectionLabActivity

/** Debug build: the welcome screen links to the Detection lab. The release twin (src/release) shows nothing. */
object DebugMenu {
    @Composable
    fun WelcomeEntry() {
        val context = LocalContext.current
        Spacer(Modifier.height(24.dp))
        OutlinedButton(onClick = { context.startActivity(Intent(context, DetectionLabActivity::class.java)) }) {
            Text(stringResource(R.string.lab_open))
        }
    }
}
