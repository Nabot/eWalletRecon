package com.ewallet.capture.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Capture handset palette — veld green on mist (matches launcher). */
object CaptureColors {
    val Veld = Color(0xFF1F5C37)
    val VeldDeep = Color(0xFF153F26)
    val VeldSoft = Color(0xFFDCEADE)
    val Mist = Color(0xFFEEF2EF)
    val Paper = Color(0xFFF7F4EF)
    val Ink = Color(0xFF14261C)
    val InkMuted = Color(0xFF4A5C52)
    val Danger = Color(0xFFB42318)
    val DangerSoft = Color(0xFFF9E4E2)
    val Warn = Color(0xFF9A6700)
    val WarnSoft = Color(0xFFF5E6C8)
    val Ok = Color(0xFF1F5C37)
    val OkSoft = Color(0xFFDCEADE)
}

private val LightScheme = lightColorScheme(
    primary = CaptureColors.Veld,
    onPrimary = CaptureColors.Paper,
    primaryContainer = CaptureColors.VeldSoft,
    onPrimaryContainer = CaptureColors.VeldDeep,
    secondary = CaptureColors.InkMuted,
    onSecondary = CaptureColors.Paper,
    background = CaptureColors.Mist,
    onBackground = CaptureColors.Ink,
    surface = CaptureColors.Paper,
    onSurface = CaptureColors.Ink,
    surfaceVariant = CaptureColors.VeldSoft,
    onSurfaceVariant = CaptureColors.InkMuted,
    error = CaptureColors.Danger,
    onError = Color.White,
    outline = Color(0xFFB7C4BB),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFF8FCB9B),
    onPrimary = CaptureColors.VeldDeep,
    primaryContainer = CaptureColors.Veld,
    onPrimaryContainer = CaptureColors.Paper,
    background = Color(0xFF0F1A14),
    onBackground = CaptureColors.Paper,
    surface = Color(0xFF16241C),
    onSurface = CaptureColors.Paper,
    surfaceVariant = Color(0xFF24352B),
    onSurfaceVariant = Color(0xFFB7C4BB),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    outline = Color(0xFF7A8B80),
)

private val CaptureTypography = Typography(
    headlineLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        letterSpacing = (-0.3).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 18.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.2.sp,
    ),
)

@Composable
fun CaptureTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = CaptureTypography,
        content = content,
    )
}
