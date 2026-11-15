package io.github.pranto404.reelity

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.pranto404.reelity.ui.WelcomeScreen
import io.github.pranto404.reelity.ui.theme.ReelityTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ReelityTheme {
                WelcomeScreen()
            }
        }
    }
}
