package za.co.proteabank.authenticator

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import za.co.proteabank.authenticator.core.Keys
import za.co.proteabank.authenticator.core.Messages
import za.co.proteabank.authenticator.core.Requests
import za.co.proteabank.authenticator.device.DeviceKeys

/** Runs on a real phone: the keys the bank will trust live in its Keystore. Needs no fingerprint. */
@RunWith(AndroidJUnit4::class)
class DeviceKeysTest {
	@Before fun setUp() { DeviceKeys.create() }
	@After fun tearDown() { DeviceKeys.delete() }

	@Test fun twoDifferentKeysAreMadeAsBankJwks() {
		val (auth, approval) = DeviceKeys.publicKeys()
		assertNotEquals(auth, approval)
		for (k in listOf(auth, approval)) { assertEquals(43, k.x.length); assertEquals(43, k.y.length) }
	}

	@Test fun theAuthKeySignsARequestWithNoFingerprintAndTheBankCouldVerifyIt() {
		val h = Requests.headers("dev_t", "POST", "app.proteabank.co.za", "/authenticator/operations/op_1/decline", "", DeviceKeys::signWithAuthKey)
		val text = Messages.request("POST", "app.proteabank.co.za", "/authenticator/operations/op_1/decline", h["x-device-time"]!!, h["x-device-nonce"]!!, "")
		assertTrue(Keys.verify(DeviceKeys.publicKeys().first, text, h["x-device-signature"]!!))
		assertTrue(!Keys.verify(DeviceKeys.publicKeys().second, text, h["x-device-signature"]!!)) // not the approval key
	}

	@Test fun theApprovalKeyCannotSignWithoutTheFingerprint() {
		assertThrows(Exception::class.java) {
			val s = DeviceKeys.approvalSignature()
			s.update("anything".toByteArray())
			s.sign()
		}
	}

	@Test fun theKeysSayWhereTheyLiveAndWhichNeedsAFingerprint() {
		val lines = DeviceKeys.describe()
		assertTrue(lines[0].contains("no fingerprint")); assertTrue(lines[1].contains("fingerprint required"))
		assertTrue(lines.none { it.contains("software") })
	}
}
