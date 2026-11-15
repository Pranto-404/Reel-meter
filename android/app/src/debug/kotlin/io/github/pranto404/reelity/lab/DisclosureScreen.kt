package io.github.pranto404.reelity.lab

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.pranto404.reelity.R

/**
 * The prominent disclosure, shown before Settings opens (Play's Accessibility API policy). Standalone and
 * scrollable, both buttons always visible, Back = "Not now", and "Not now" keeps the app usable.
 */
@Composable
fun DisclosureScreen(onAgree: () -> Unit, onNotNow: () -> Unit) {
    BackHandler(onBack = onNotNow)
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(modifier = Modifier.safeDrawingPadding()) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = stringResource(R.string.disclosure_title),
                    modifier = Modifier.semantics { heading() },
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                Text(stringResource(R.string.disclosure_intro), style = MaterialTheme.typography.bodyLarge)
                Section(R.string.disclosure_checks_label, R.string.disclosure_checks_body)
                Section(R.string.disclosure_never_label, R.string.disclosure_never_body)
                Section(R.string.disclosure_does_label, R.string.disclosure_does_body)
                Section(R.string.disclosure_test_label, R.string.disclosure_test_body)
                Section(R.string.disclosure_data_label, R.string.disclosure_data_body)
                Section(R.string.disclosure_headsup_label, R.string.disclosure_headsup_body)
                Text(stringResource(R.string.disclosure_off), style = MaterialTheme.typography.bodyMedium)
            }
            HorizontalDivider()
            Column(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = onAgree, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.disclosure_agree))
                }
                OutlinedButton(onClick = onNotNow, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.disclosure_not_now))
                }
            }
        }
    }
}

@Composable
private fun Section(@StringRes label: Int, @StringRes body: Int) {
    Column {
        Text(
            text = stringResource(label),
            modifier = Modifier.semantics { heading() },
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(4.dp))
        Text(stringResource(body), style = MaterialTheme.typography.bodyMedium)
    }
}
