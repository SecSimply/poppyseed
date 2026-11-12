package za.co.proteabank.authenticator

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import za.co.proteabank.authenticator.core.EnrollResult
import za.co.proteabank.authenticator.core.Enrollment
import za.co.proteabank.authenticator.core.EnrollmentLink
import za.co.proteabank.authenticator.device.DeviceKeys
import za.co.proteabank.authenticator.net.Http
import za.co.proteabank.authenticator.store.DeviceStore
import za.co.proteabank.authenticator.store.Enrolled

private sealed interface Screen {
	data object Home : Screen
	data object Scanning : Screen
	data class Confirm(val link: EnrollmentLink) : Screen
	data class Working(val what: String) : Screen
	data class Code(val code: String, val customer: String, val enrolled: Enrolled) : Screen
	data class Problem(val text: String) : Screen
}

class MainActivity : FragmentActivity() {
	/** A protea://enroll link opened from outside (a tap on the bank's "Cannot scan?" link) waits here for the screen to take it. */
	private var pending by mutableStateOf<String?>(null)

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		pending = intent?.data?.toString()
		val store = DeviceStore(this)
		setContent { MaterialTheme { Column(Modifier.fillMaxSize().padding(20.dp).verticalScroll(rememberScrollState())) { App(store) } } }
	}

	override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); pending = intent.data?.toString() }

	@Composable
	private fun App(store: DeviceStore) {
		var enrolled by remember { mutableStateOf(store.load()) }
		var screen by remember { mutableStateOf<Screen>(Screen.Home) }
		var check by remember { mutableStateOf<String?>(null) }
		val camera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> screen = if (ok) Screen.Scanning else Screen.Problem("The camera is needed to scan the code. You can also paste the link below.") }

		fun take(text: String) {
			val link = EnrollmentLink.parse(text)
			screen = if (link == null) Screen.Problem("That is not a Protea enrollment code.") else Screen.Confirm(link)
		}
		pending?.let { p -> pending = null; take(p) }

		fun enroll(link: EnrollmentLink) {
			screen = Screen.Working("Enrolling")
			val (auth, approval) = DeviceKeys.create()
			Http.run({ Http.send(link.origin, "POST", "/authenticator/enroll", Enrollment.body(link, Build.MODEL, auth, approval)) }) { r ->
				val outcome = r.fold({ Enrollment.result(link, it.status, it.body) }, { EnrollResult.Refused("Could not reach the bank: ${it.message}") })
				screen = when (outcome) {
					is EnrollResult.Enrolled -> Enrolled(link.origin, outcome.deviceId, outcome.customer).let { e ->
						store.save(e); enrolled = e; Screen.Code(outcome.code, outcome.customer, e)
					}
					is EnrollResult.Refused -> { DeviceKeys.delete(); Screen.Problem(outcome.reason) }
				}
			}
		}

		when (val s = screen) {
			Screen.Home -> if (enrolled != null) Enrolled(enrolled!!, check, onCheck = {
				val e = enrolled!!; check = "Checking…"
				Http.run({ Http.signed(e.origin, e.deviceId, "GET", "/authenticator/operations") }) { r ->
					check = r.fold({ if (it.status == 200) "Connected. Nothing is waiting." .takeIf { _ -> !it.body.contains("operation_id") } ?: "Connected. Something is waiting." else if (it.status == 401) "The bank does not accept this phone yet. Press \"The codes match\" on the website." else "The bank answered ${it.status}." }, { "Could not reach the bank: ${it.message}" })
				}
			}, onRemove = { DeviceKeys.delete(); store.clear(); enrolled = null; check = null })
			else Home(onScan = {
				if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) screen = Screen.Scanning else camera.launch(Manifest.permission.CAMERA)
			}, onPaste = ::take)
			Screen.Scanning -> {
				var found by remember { mutableStateOf(false) }
				Text("Point the camera at the code on the bank's Account page.", fontSize = 16.sp)
				Spacer(Modifier.height(12.dp))
				QrScanner(this, Modifier.fillMaxSize().height(420.dp)) { text -> if (!found) { found = true; take(text) } }
				OutlinedButton(onClick = { screen = Screen.Home }) { Text("Cancel") }
			}
			is Screen.Confirm -> {
				Text("Add this phone to", fontSize = 16.sp)
				Text(s.link.origin, fontSize = 22.sp)
				Spacer(Modifier.height(8.dp))
				Text("Only continue if this is your bank's address and you opened the code yourself on its website.")
				Spacer(Modifier.height(16.dp))
				Button(onClick = { enroll(s.link) }) { Text("Continue") }
				OutlinedButton(onClick = { screen = Screen.Home }) { Text("Cancel") }
			}
			is Screen.Working -> Text("${s.what}…")
			is Screen.Code -> {
				Text("Check this code", fontSize = 16.sp)
				Text(s.code.chunked(3).joinToString(" "), fontSize = 44.sp)
				Spacer(Modifier.height(8.dp))
				Text("Enrolled for ${s.customer}. The bank's website shows a code too. If it is the same, press \"The codes match\" there. If not, do not: remove this phone and start again.")
				Spacer(Modifier.height(16.dp))
				Button(onClick = { screen = Screen.Home }) { Text("Done") }
			}
			is Screen.Problem -> {
				Text(s.text)
				Spacer(Modifier.height(12.dp))
				Button(onClick = { screen = Screen.Home }) { Text("Back") }
			}
		}
	}

	@Composable
	private fun Home(onScan: () -> Unit, onPaste: (String) -> Unit) {
		var link by remember { mutableStateOf("") }
		Text("Protea", fontSize = 28.sp)
		Spacer(Modifier.height(8.dp))
		Text("This phone is not set up. On the bank's website, sign in, open Account, press \"Add my phone\", and scan the code.")
		Spacer(Modifier.height(16.dp))
		Button(onClick = onScan) { Text("Scan the code") }
		Spacer(Modifier.height(24.dp))
		OutlinedTextField(value = link, onValueChange = { link = it }, label = { Text("Or paste the link") }, singleLine = true)
		OutlinedButton(onClick = { onPaste(link) }, enabled = link.isNotBlank()) { Text("Use this link") }
	}

	@Composable
	private fun Enrolled(e: Enrolled, check: String?, onCheck: () -> Unit, onRemove: () -> Unit) {
		Text("Protea", fontSize = 28.sp)
		Spacer(Modifier.height(8.dp))
		Text("Enrolled for ${e.customer}")
		Text(e.origin)
		Spacer(Modifier.height(16.dp))
		Button(onClick = onCheck) { Text("Check the connection") }
		check?.let { Spacer(Modifier.height(8.dp)); Text(it) }
		Spacer(Modifier.height(24.dp))
		OutlinedButton(onClick = onRemove) { Text("Remove this phone from the app") }
		Text("Removing it here does not remove it at the bank: ask staff, or add the phone again after they do.", fontSize = 13.sp)
	}
}
