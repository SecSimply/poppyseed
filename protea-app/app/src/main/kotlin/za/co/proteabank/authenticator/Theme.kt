package za.co.proteabank.authenticator

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// The same colours as the bank's website (nova/app/protea.css): crimson on blush in the light theme, rose on deep leaf green in the dark one.
private val Light = lightColorScheme(
	background = Color(0xFFFBF5F2), onBackground = Color(0xFF2B1219),
	surface = Color(0xFFFBF5F2), onSurface = Color(0xFF2B1219),
	surfaceVariant = Color(0xFFF6EBEA), onSurfaceVariant = Color(0xFF6C5560),
	primary = Color(0xFFA8123B), onPrimary = Color(0xFFFFFFFF),
	secondary = Color(0xFF2F6B3A), onSecondary = Color(0xFFFFFFFF),
	outline = Color(0xFFECDCDD), outlineVariant = Color(0xFFECDCDD),
	error = Color(0xFFB42318), onError = Color(0xFFFFFFFF),
)

private val Dark = darkColorScheme(
	background = Color(0xFF0F1A13), onBackground = Color(0xFFF7ECE8),
	surface = Color(0xFF0F1A13), onSurface = Color(0xFFF7ECE8),
	surfaceVariant = Color(0xFF1D2F23), onSurfaceVariant = Color(0xFFB9AAA6),
	primary = Color(0xFFF2708F), onPrimary = Color(0xFF1A0A10),
	secondary = Color(0xFF7FC28E), onSecondary = Color(0xFF1A0A10),
	outline = Color(0xFF28392D), outlineVariant = Color(0xFF28392D),
	error = Color(0xFFFF8A80), onError = Color(0xFF1A0A10),
)

@Composable
fun ProteaTheme(content: @Composable () -> Unit) {
	MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light) {
		Surface(color = MaterialTheme.colorScheme.background, content = content)
	}
}
