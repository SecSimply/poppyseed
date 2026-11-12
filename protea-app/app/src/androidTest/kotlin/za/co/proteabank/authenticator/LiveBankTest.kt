package za.co.proteabank.authenticator

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import za.co.proteabank.authenticator.core.EnrollResult
import za.co.proteabank.authenticator.core.Enrollment
import za.co.proteabank.authenticator.core.EnrollmentLink
import za.co.proteabank.authenticator.device.DeviceKeys
import za.co.proteabank.authenticator.net.Http

/** From a real phone to the real bank, with nothing that changes anything: a made-up enrollment is refused, a made-up device is not known. */
@RunWith(AndroidJUnit4::class)
class LiveBankTest {
	@After fun tearDown() { DeviceKeys.delete() }

	@Test fun aMadeUpEnrollmentIsRefusedTheSameWayAsAnyBadOne() {
		val link = EnrollmentLink.parse("protea://enroll?o=https%3A%2F%2Fapp.proteabank.co.za&e=enr_doesnotexist&s=nope")!!
		val (auth, approval) = DeviceKeys.create()
		val r = Http.send(link.origin, "POST", "/authenticator/enroll", Enrollment.body(link, "Test phone", auth, approval))
		assertEquals(400, r.status)
		assertTrue(Enrollment.result(link, r.status, r.body) is EnrollResult.Refused)
	}

	@Test fun aSignedRequestFromAnUnknownDeviceIsRefusedWithoutDetail() {
		DeviceKeys.create()
		val r = Http.signed("https://app.proteabank.co.za", "dev_doesnotexist", "GET", "/authenticator/operations")
		assertEquals(401, r.status)
		assertTrue(r.body.contains("invalid_device_request"))
	}
}
