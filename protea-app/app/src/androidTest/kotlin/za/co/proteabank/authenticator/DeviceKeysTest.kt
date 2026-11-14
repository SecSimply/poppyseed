package za.co.proteabank.authenticator

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import za.co.proteabank.authenticator.device.DeviceKeys

/** Runs on a real phone: the keys the bank and the sign-in service will trust live in its Keystore. Needs no fingerprint. */
@RunWith(AndroidJUnit4::class)
class DeviceKeysTest {
	@Before fun setUp() { DeviceKeys.create(); DeviceKeys.createSignin() }
	@After fun tearDown() { DeviceKeys.delete(); DeviceKeys.deleteSignin() }

	@Test fun theApprovalKeyIsMadeAsABankJwk() {
		val k = DeviceKeys.approvalPublicKey()
		assertEquals(43, k.x.length); assertEquals(43, k.y.length)
	}

	@Test fun neitherKeyCanSignWithoutTheFingerprint() {
		for (make in listOf(DeviceKeys::approvalSignature, DeviceKeys::signinSignature)) {
			assertThrows(Exception::class.java) {
				val s = make()
				s.update("anything".toByteArray())
				s.sign()
			}
		}
	}

	@Test fun bothKeysSayWhereTheyLiveAndThatTheyNeedAFingerprint() {
		val lines = DeviceKeys.describe()
		assertEquals(2, lines.size)
		assertTrue(lines.all { it.contains("fingerprint required") })
		assertTrue(lines.none { it.contains("software") })
	}
}
