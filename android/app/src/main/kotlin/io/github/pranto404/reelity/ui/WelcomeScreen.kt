package io.github.pranto404.reelity.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.pranto404.reelity.R

/** The M0 placeholder screen: brand, promise and what comes next. Scrolls, so it also fits at 200% font size. */
@Composable
fun WelcomeScreen(modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(colors.primaryContainer, colors.surface)))
            .safeDrawingPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 480.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 32.dp, vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.ic_logo),
                contentDescription = null,
                modifier = Modifier.size(112.dp),
            )
            Spacer(Modifier.height(28.dp))
            Text(
                text = stringResource(R.string.app_name),
                modifier = Modifier.semantics { heading() },
                style = MaterialTheme.typography.displayMedium,
                fontWeight = FontWeight.Bold,
                color = colors.onSurface,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.welcome_tagline),
                style = MaterialTheme.typography.titleLarge,
                color = colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(32.dp))
            Surface(
                shape = CircleShape,
                color = colors.secondaryContainer,
                contentColor = colors.onSecondaryContainer,
            ) {
                Text(
                    text = stringResource(R.string.welcome_privacy),
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.labelLarge,
                    textAlign = TextAlign.Center,
                )
            }
            Spacer(Modifier.height(40.dp))
            Text(
                text = stringResource(R.string.welcome_status),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}
