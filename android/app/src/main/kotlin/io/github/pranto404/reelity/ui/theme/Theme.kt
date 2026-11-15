package io.github.pranto404.reelity.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Brand colours from the logo: blue #2A78D6 to teal #0E8A8F. The light primary is a shade darker and the dark
// one lighter so text on and next to them keeps 4.5:1 contrast. No dynamic colour: the brand stays recognisable.
private val LightColors = lightColorScheme(
    primary = Color(0xFF1F66C1),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD7E5FF),
    onPrimaryContainer = Color(0xFF001B3F),
    secondary = Color(0xFF0B7479),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFC8EEEF),
    onSecondaryContainer = Color(0xFF002022),
    background = Color(0xFFF7F9FC),
    onBackground = Color(0xFF181C22),
    surface = Color(0xFFF7F9FC),
    onSurface = Color(0xFF181C22),
    onSurfaceVariant = Color(0xFF43474F),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFA8C8FF),
    onPrimary = Color(0xFF002F65),
    primaryContainer = Color(0xFF0F3F7A),
    onPrimaryContainer = Color(0xFFD7E5FF),
    secondary = Color(0xFF7CD6DA),
    onSecondary = Color(0xFF003739),
    secondaryContainer = Color(0xFF004F52),
    onSecondaryContainer = Color(0xFFC8EEEF),
    background = Color(0xFF10141A),
    onBackground = Color(0xFFE0E2EA),
    surface = Color(0xFF10141A),
    onSurface = Color(0xFFE0E2EA),
    onSurfaceVariant = Color(0xFFC3C6D0),
)

@Composable
fun ReelityTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
