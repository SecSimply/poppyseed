package za.co.proteabank.authenticator

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import za.co.proteabank.authenticator.core.Keys
import za.co.proteabank.authenticator.core.Messages
import za.co.proteabank.authenticator.core.Requests
import za.co.proteabank.authenticator.device.Approver
import za.co.proteabank.authenticator.device.ApprovalResult
import za.co.proteabank.authenticator.device.DeviceKeys

/** Step 2: a bench for the keys. It makes them, signs a request, and signs an approval after the fingerprint, and checks each signature. */
class MainActivity : FragmentActivity() {
	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		setContent {
			MaterialTheme {
				var log by remember { mutableStateOf(listOf("Protea authenticator, key bench")) }
				fun say(line: String) { log = log + line }
				Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {
					Button(onClick = {
						val (auth, approval) = DeviceKeys.create()
						say("Made two keys."); DeviceKeys.describe().forEach(::say)
						say("auth x: ${auth.x}"); say("approval x: ${approval.x}")
					}) { Text("Make the two keys") }
					Button(onClick = {
						if (!DeviceKeys.exists()) return@Button say("Make the keys first.")
						val headers = Requests.headers("dev_bench", "GET", "app.proteabank.co.za", "/authenticator/operations", "", DeviceKeys::signWithAuthKey)
						val text = Messages.request("GET", "app.proteabank.co.za", "/authenticator/operations", headers["x-device-time"]!!, headers["x-device-nonce"]!!, "")
						say("Signed a request, no fingerprint. Verifies: " + Keys.verify(DeviceKeys.publicKeys().first, text, headers["x-device-signature"]!!))
					}) { Text("Sign a request (no fingerprint)") }
					Button(onClick = {
						if (!DeviceKeys.exists()) return@Button say("Make the keys first.")
						if (!Approver.canAuthenticate(this@MainActivity)) return@Button say("No fingerprint is set up on this phone.")
						Approver.approve(this@MainActivity, "https://app.proteabank.co.za", "dev_bench", "op_bench", 1, "hash", "Pay R10,00 to Boland Power") { r ->
							when (r) {
								is ApprovalResult.Signed -> {
									val text = Messages.approval("https://app.proteabank.co.za", "dev_bench", "op_bench", 1, "hash", r.approval.nonce, r.approval.time)
									say("Approved with the fingerprint. Verifies: " + Keys.verify(DeviceKeys.publicKeys().second, text, r.approval.signature))
								}
								is ApprovalResult.NotApproved -> say("Not approved: ${r.reason}")
								ApprovalResult.KeyLost -> say("The key was lost: a fingerprint was added. Enroll again.")
							}
						}
					}) { Text("Sign an approval (fingerprint)") }
					log.forEach { Text(it) }
				}
			}
		}
	}
}
