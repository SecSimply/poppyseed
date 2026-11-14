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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import za.co.proteabank.authenticator.core.Operations
import za.co.proteabank.authenticator.core.Outcome
import za.co.proteabank.authenticator.core.PendingOperation
import za.co.proteabank.authenticator.device.Approver
import za.co.proteabank.authenticator.device.ApprovalResult
import za.co.proteabank.authenticator.device.DeviceKeys
import za.co.proteabank.authenticator.net.Http
import za.co.proteabank.authenticator.store.DeviceStore
import za.co.proteabank.authenticator.store.Enrolled
import za.co.proteabank.authenticator.store.SigninDevice
import za.co.proteabank.authenticator.store.SigninStore
import za.co.proteabank.authenticator.core.SigninEnrollment
import za.co.proteabank.authenticator.core.SigninLink
import za.co.proteabank.authenticator.device.SignWith
import za.co.proteabank.authenticator.device.SigninSigned
import za.co.proteabank.authenticator.core.Messages
import za.co.proteabank.authenticator.core.Nonce
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.LifecycleEventObserver
import za.co.proteabank.authenticator.device.SigninSigner

private sealed interface Screen {
	data object Home : Screen
	data object Scanning : Screen
	data class Confirm(val link: EnrollmentLink) : Screen
	data class Working(val what: String) : Screen
	data class Code(val code: String, val customer: String, val enrolled: Enrolled) : Screen
	data class Problem(val text: String) : Screen
	data class Detail(val op: PendingOperation) : Screen
	data class Result(val text: String, val removeNow: Boolean = false) : Screen
}

class MainActivity : FragmentActivity() {
	/** A protea://enroll link opened from outside (a tap on the bank's "Cannot scan?" link) waits here for the screen to take it. */
	private var pending by mutableStateOf<String?>(null)

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		pending = intent?.data?.toString()
		val store = DeviceStore(this)
		val signinStore = SigninStore(this)
		setContent { ProteaTheme { Column(Modifier.fillMaxSize().padding(20.dp).verticalScroll(rememberScrollState())) { App(store, signinStore) } } }
	}

	override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); pending = intent.data?.toString() }

	@Composable
	private fun App(store: DeviceStore, signinStore: SigninStore) {
		var enrolled by remember { mutableStateOf(store.load()) }
		var signin by remember { mutableStateOf(signinStore.load()) }
		var screen by remember { mutableStateOf<Screen>(Screen.Home) }
		var status by remember { mutableStateOf<String?>(null) }
		/** The device auth service's session, kept in memory only: gone when the app goes to the background, so the fingerprint is asked for again. */
		var session by remember { mutableStateOf<String?>(null) }
		var ops by remember { mutableStateOf<List<PendingOperation>>(emptyList()) }
		val camera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> screen = if (ok) Screen.Scanning else Screen.Problem("The camera is needed to scan the code. You can also paste the link below.") }

		fun refresh() {
			val e = enrolled ?: return
			val token = session ?: return
			Http.run({ Http.bearer(e.origin, token, "GET", "/authenticator/operations") }) { r ->
				r.fold({
					when (it.status) {
						200 -> { ops = Operations.list(it.body).filter { o -> o.open }; status = null }
						401 -> { ops = emptyList(); status = null; session = null } // it ran out, or the phone was removed: ask for the fingerprint again
						503 -> status = "The sign-in service is not available right now. Waiting payments cannot be shown."
						else -> status = "The bank answered ${it.status}."
					}
				}, { status = "Could not reach the bank: ${it.message}" })
			}
		}
		LaunchedEffect(enrolled, session != null) {
			if (enrolled != null && session != null) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { while (true) { refresh(); delay(5_000) } }
		}
		DisposableEffect(Unit) {
			val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) { session = null; ops = emptyList() } }
			lifecycle.addObserver(observer)
			onDispose { lifecycle.removeObserver(observer) }
		}

		fun finish(approving: Boolean, op: PendingOperation, result: Result<za.co.proteabank.authenticator.net.HttpResult>) {
			val outcome = result.fold({ Operations.outcome(approving, it.status, it.body) }, { Outcome.Failed("Could not reach the bank: ${it.message}") })
			screen = Screen.Result(when (outcome) {
				Outcome.Approved -> "Approved. The bank is making the payment."
				Outcome.Declined -> "Declined. Nothing was paid."
				is Outcome.Changed -> "This payment changed while you were looking at it. Nothing was approved. It will show again with its new terms."
				Outcome.NotOpen -> "This payment was already decided or has expired."
				Outcome.Locked -> { session = null; ops = emptyList(); "The app locked while you were looking. Unlock it with your fingerprint and try again. Nothing was paid." }
				Outcome.Refused -> "The bank refused the approval. Nothing was paid."
				Outcome.Gone -> "The bank no longer has this payment."
				is Outcome.Failed -> outcome.text
			})
			refresh()
		}

		fun approve(op: PendingOperation) {
			val e = enrolled ?: return
			val token = session ?: return
			val hash = op.hash ?: return
			if (!op.consistent) return
			Approver.approve(this, e.origin, e.deviceId, op.id, op.revision, hash, "${op.amount ?: ""} ${op.summary}".trim()) { signed ->
				when (signed) {
					is ApprovalResult.Signed -> {
						screen = Screen.Working("Sending your approval")
						Http.run({ Http.bearer(e.origin, token, "POST", "/authenticator/operations/${op.id}/approve", Operations.approveBody(op.revision, signed.approval)) }) { finish(true, op, it) }
					}
					is ApprovalResult.NotApproved -> screen = Screen.Result("Not approved: ${signed.reason}. Nothing was paid.")
					ApprovalResult.KeyLost -> screen = Screen.Result("A fingerprint was added to this phone, so the approval key stopped working. Remove the phone here and enroll again.", removeNow = true)
				}
			}
		}

		fun decline(op: PendingOperation) {
			val e = enrolled ?: return
			val token = session ?: return
			screen = Screen.Working("Declining")
			Http.run({ Http.bearer(e.origin, token, "POST", "/authenticator/operations/${op.id}/decline") }) { finish(false, op, it) }
		}

		fun take(text: String) {
			val link = EnrollmentLink.parse(text)
			screen = if (link == null) Screen.Problem("That is not a Protea enrollment code.") else Screen.Confirm(link)
		}
		pending?.let { p -> pending = null; take(p) }

		fun enroll(link: EnrollmentLink) {
			screen = Screen.Working("Enrolling")
			DeviceKeys.deleteSignin(); signinStore.clear(); signin = null // a sign-in registration left over from an earlier setup is not this customer's
			val approval = DeviceKeys.create()
			Http.run({ Http.send(link.origin, "POST", "/authenticator/enroll", Enrollment.body(link, Build.MODEL, approval)) }) { r ->
				val outcome = r.fold({ Enrollment.result(link, it.status, it.body) }, { EnrollResult.Refused("Could not reach the bank: ${it.message}") })
				screen = when (outcome) {
					is EnrollResult.Enrolled -> Enrolled(link.origin, outcome.deviceId, outcome.customer).let { e ->
						store.save(e); enrolled = e; Screen.Code(outcome.code, outcome.customer, e)
					}
					is EnrollResult.Refused -> { DeviceKeys.delete(); Screen.Problem(outcome.reason) }
				}
			}
		}

		/** Registers the phone's sign-in key with the device auth service: a challenge, one fingerprint to sign it, then the registration with the code. */
		fun enrollSignin(link: SigninLink) {
			screen = Screen.Working("Registering this phone")
			val deviceId = SigninEnrollment.newDeviceId()
			val publicKey = try { DeviceKeys.createSignin() } catch (e: Exception) { return run { screen = Screen.Problem("Could not make the key: ${e.message}") } }
			fun fail(text: String) { DeviceKeys.deleteSignin(); screen = Screen.Problem(text) }
			Http.run({ Http.send(link.origin, "POST", "/v1/registrations/challenge", SigninEnrollment.challengeBody(deviceId)) }) { r ->
				val c = r.getOrNull()?.let { SigninEnrollment.challenge(it.status, it.body) } ?: return@run fail("Could not get a challenge from the service.")
				SigninSigner.sign(this, SignWith.SIGNIN, SigninEnrollment.message("register", c.value, deviceId, c.audience), "Register this phone", link.origin) { signed ->
					when (signed) {
						is SigninSigned.Signed -> {
							screen = Screen.Working("Registering this phone")
							Http.run({ Http.send(link.origin, "POST", "/v1/registrations", SigninEnrollment.body(c.value, deviceId, publicKey, signed.standard, Build.MODEL, link.code)) }) { done ->
								val res = done.getOrNull()
								if (res?.status == 201) { SigninDevice(link.origin, deviceId).let { signinStore.save(it); signin = it }; screen = Screen.Result("This phone is set up. Unlock the app with your fingerprint to see what is waiting for you.") }
								else fail(res?.let { SigninEnrollment.refusal(it.status) } ?: "Could not reach the service.")
							}
						}
						is SigninSigned.NotSigned -> fail("Not registered: ${signed.reason}.")
						SigninSigned.KeyLost -> fail("The key stopped working. Scan a new code.")
					}
				}
			}
		}

		/**
		 * The confirmed phone asks the bank for a one-time code for the sign-in service, signing the request with the approval key (one
		 * fingerprint), then registers with the sign-in key (another).
		 */
		fun finishSetup() {
			val e = enrolled ?: return
			val nonce = Nonce.make()
			val time = System.currentTimeMillis().toString()
			SigninSigner.sign(this, SignWith.APPROVAL, Messages.signinCode(e.origin, e.deviceId, nonce, time), "Finish setting up", e.origin) { signed ->
				when (signed) {
					is SigninSigned.Signed -> {
						screen = Screen.Working("Finishing setup")
						Http.run({ Http.send(e.origin, "POST", "/authenticator/signin-code", SigninEnrollment.codeRequestBody(e.deviceId, nonce, time, signed.url)) }) { r ->
							val res = r.getOrNull() ?: return@run run { screen = Screen.Problem("Could not reach the bank.") }
							val link = SigninLink.fromAnswer(res.status, res.body)
							if (link != null) enrollSignin(link)
							else screen = Screen.Problem(when (res.status) {
								401 -> "The bank does not accept this phone yet. Press \"The codes match\" on the website first."
								409 -> "This phone is already set up, or the customer already has the most phones registered for signing in."
								else -> "The bank could not finish the setup (${res.status}). Try again in a few minutes."
							})
						}
					}
					is SigninSigned.NotSigned -> screen = Screen.Home
					SigninSigned.KeyLost -> screen = Screen.Result("A fingerprint was added to this phone, so its keys stopped working. Remove the phone here and enroll again.", removeNow = true)
				}
			}
		}

		/** Unlocks the app: the sign-in key signs a challenge from the service (the fingerprint), which answers with a short session. */
		fun unlock() {
			val si = signin ?: return
			screen = Screen.Working("Unlocking")
			Http.run({ Http.send(si.origin, "POST", "/v1/auth/challenge", SigninEnrollment.challengeBody(si.deviceId)) }) { r ->
				val c = r.getOrNull()?.let { SigninEnrollment.challenge(it.status, it.body) } ?: return@run run { screen = Screen.Problem("Could not reach the sign-in service.") }
				SigninSigner.sign(this, SignWith.SIGNIN, SigninEnrollment.message("auth", c.value, si.deviceId, c.audience), "Unlock Protea", si.origin) { signed ->
					when (signed) {
						is SigninSigned.Signed -> {
							screen = Screen.Working("Unlocking")
							Http.run({ Http.send(si.origin, "POST", "/v1/auth/verify", SigninEnrollment.verifyBody(c.value, si.deviceId, signed.standard)) }) { done ->
								val token = done.getOrNull()?.let { SigninEnrollment.session(it.status, it.body) }
								if (token == null) screen = Screen.Problem("The sign-in service did not accept the unlock.")
								else { session = token; screen = Screen.Home; refresh() }
							}
						}
						is SigninSigned.NotSigned -> screen = Screen.Home
						SigninSigned.KeyLost -> screen = Screen.Result("A fingerprint was added to this phone, so its keys stopped working. Remove the phone here and enroll again.", removeNow = true)
					}
				}
			}
		}

		fun removeHere() { DeviceKeys.delete(); DeviceKeys.deleteSignin(); store.clear(); signinStore.clear(); signin = null; session = null; enrolled = null; ops = emptyList(); status = null }

		when (val s = screen) {
			Screen.Home -> {
				val e = enrolled
				when {
					e == null -> Home(onScan = {
						if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) screen = Screen.Scanning else camera.launch(Manifest.permission.CAMERA)
					}, onPaste = ::take)
					signin == null -> FinishSetup(e, onFinish = ::finishSetup, onRemove = ::removeHere)
					session == null -> Locked(e, onUnlock = ::unlock, onRemove = ::removeHere)
					else -> Inbox(e, ops, status, onOpen = { screen = Screen.Detail(it) }, onRemove = ::removeHere)
				}
			}
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
				Text("Enrolled for ${s.customer}. The bank's website shows a code too. If it is the same, press \"The codes match\" there, then come back here and press \"Finish setting up\". If not, do not: remove this phone and start again.")
				Spacer(Modifier.height(16.dp))
				Button(onClick = { screen = Screen.Home }) { Text("Done") }
			}
			is Screen.Detail -> {
				// The list refreshes under us: show the latest version of this payment, or say it is gone.
				val op = ops.firstOrNull { it.id == s.op.id } ?: s.op
				Detail(op, stillOpen = ops.any { it.id == op.id }, onApprove = { approve(op) }, onDecline = { decline(op) }, onBack = { screen = Screen.Home })
			}
			is Screen.Result -> {
				Text(s.text, fontSize = 18.sp)
				Spacer(Modifier.height(16.dp))
				Button(onClick = { if (s.removeNow) removeHere(); screen = Screen.Home }) { Text(if (s.removeNow) "Remove this phone" else "Back") }
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
	private fun FinishSetup(e: Enrolled, onFinish: () -> Unit, onRemove: () -> Unit) {
		Text("Protea", fontSize = 28.sp)
		Text("${e.customer} · ${e.origin}", fontSize = 13.sp)
		Spacer(Modifier.height(16.dp))
		Text("One more step. First press \"The codes match\" on the bank's website if you have not. Then finish setting up: you will be asked for your fingerprint twice, once to ask the bank and once to register this phone for unlocking the app.")
		Spacer(Modifier.height(16.dp))
		Button(onClick = onFinish) { Text("Finish setting up") }
		Spacer(Modifier.height(32.dp))
		OutlinedButton(onClick = onRemove) { Text("Remove this phone from the app") }
	}

	@Composable
	private fun Locked(e: Enrolled, onUnlock: () -> Unit, onRemove: () -> Unit) {
		Text("Protea", fontSize = 28.sp)
		Text("${e.customer} · ${e.origin}", fontSize = 13.sp)
		Spacer(Modifier.height(16.dp))
		Text("Locked. Unlock the app with your fingerprint to see what is waiting for you.")
		Spacer(Modifier.height(16.dp))
		Button(onClick = onUnlock) { Text("Unlock") }
		Spacer(Modifier.height(32.dp))
		OutlinedButton(onClick = onRemove) { Text("Remove this phone from the app") }
		Text("Removing it here does not remove it at the bank: ask staff, or add the phone again after they do.", fontSize = 13.sp)
	}

	@Composable
	private fun Inbox(e: Enrolled, ops: List<PendingOperation>, status: String?, onOpen: (PendingOperation) -> Unit, onRemove: () -> Unit) {
		Text("Protea", fontSize = 28.sp)
		Text("${e.customer} · ${e.origin}", fontSize = 13.sp)
		Spacer(Modifier.height(16.dp))
		status?.let { Text(it); Spacer(Modifier.height(12.dp)) }
		if (status == null && ops.isEmpty()) Text("Nothing is waiting for you. This list updates while the app is open, and the app locks when you leave it.")
		ops.forEach { op ->
			OutlinedButton(onClick = { onOpen(op) }, modifier = Modifier.fillMaxWidth()) { Text("${op.amount ?: "Payment"}  ·  ${op.agentName ?: "an agent"}") }
		}
		Spacer(Modifier.height(32.dp))
		OutlinedButton(onClick = onRemove) { Text("Remove this phone from the app") }
		Text("Removing it here does not remove it at the bank: ask staff, or add the phone again after they do.", fontSize = 13.sp)
	}

	@Composable
	private fun Detail(op: PendingOperation, stillOpen: Boolean, onApprove: () -> Unit, onDecline: () -> Unit, onBack: () -> Unit) {
		Text("${op.agentName ?: "An agent"} asks you to approve", fontSize = 16.sp)
		Spacer(Modifier.height(8.dp))
		Text(op.amount ?: "", fontSize = 40.sp)
		Spacer(Modifier.height(8.dp))
		Text(op.summary, fontSize = 18.sp)
		op.expiresAt?.let { Spacer(Modifier.height(8.dp)); Text("Expires at " + runCatching { DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(it)) }.getOrDefault(it), fontSize = 13.sp) }
		Spacer(Modifier.height(20.dp))
		when {
			!op.consistent -> Text("This request does not match its own fingerprint, so it cannot be approved. Decline it and tell the bank.")
			!stillOpen -> Text("This payment is no longer waiting.")
			else -> Button(onClick = onApprove) { Text("Approve with fingerprint") }
		}
		if (stillOpen) OutlinedButton(onClick = onDecline) { Text("Decline") }
		OutlinedButton(onClick = onBack) { Text("Back") }
	}
}
