package com.travkin.flow.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val TravkinDarkColors = darkColorScheme(
    primary = Color(0xFFE0B100),
    onPrimary = Color(0xFF111827),
    secondary = Color(0xFF9EC5A5),
    background = Color(0xFF0C111A),
    onBackground = Color(0xFFF3F4F6),
    surface = Color(0xFF151C29),
    onSurface = Color(0xFFF3F4F6),
    surfaceVariant = Color(0xFF202738),
    onSurfaceVariant = Color(0xFFC7CDD8),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
)

@Composable
fun TravkinFlowTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = TravkinDarkColors,
        content = content,
    )
}
