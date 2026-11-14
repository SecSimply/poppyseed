package za.co.proteabank.authenticator.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SigninEnrollmentTest {
	private val real = "protea-device://enroll?o=https%3A%2F%2Fda.proteabank.co.za&c=enr_AbC123_-x.Secret_part-9"

	@Test fun readsTheLinkTheAccountPageShows() {
		val l = SigninLink.parse(real)!!
		assertEquals("https://da.proteabank.co.za", l.origin)
		assertEquals("enr_AbC123_-x.Secret_part-9", l.code)
	}

	@Test fun refusesAnythingElse() {
		val bad = listOf(
			"", "https://da.proteabank.co.za", "protea://enroll?o=https%3A%2F%2Fda.proteabank.co.za&c=enr_a.b",
			"protea-device://other?o=https%3A%2F%2Fda.proteabank.co.za&c=enr_a.b",
			"protea-device://enroll?o=http%3A%2F%2Fda.proteabank.co.za&c=enr_a.b", // not https
			"protea-device://enroll?o=https%3A%2F%2Fda.proteabank.co.za%2Fx&c=enr_a.b", // a path
			"protea-device://enroll?o=https%3A%2F%2Fu%40da.proteabank.co.za&c=enr_a.b", // credentials
			"protea-device://enroll?o=https%3A%2F%2Fda.proteabank.co.za&c=nodot", "protea-device://enroll?o=https%3A%2F%2Fda.proteabank.co.za&c=enr_a.",
			"protea-device://enroll?o=https%3A%2F%2Fda.proteabank.co.za&c=enr_a.b%20c", "protea-device://enroll?o=https%3A%2F%2Fda.proteabank.co.za",
		)
		for (b in bad) assertNull(b, SigninLink.parse(b))
	}

	@Test fun theSignedTextIsTheServicesFiveLines() {
		assertEquals("DEVAUTH-V1\nregister\nch\ndev_1\naud", SigninEnrollment.message("register", "ch", "dev_1", "aud"))
	}

	@Test fun aDeviceIdFitsTheServicesPattern() {
		val ids = (1..50).map { SigninEnrollment.newDeviceId() }
		assertTrue(ids.all { Regex("[A-Za-z0-9_-]{8,64}").matches(it) })
		assertEquals(50, ids.toSet().size)
	}

	@Test fun readsAChallengeAndRefusesOthers() {
		assertEquals(SigninEnrollment.Challenge("c", "a"), SigninEnrollment.challenge(200, """{"challenge":"c","audience":"a","expiresAt":"x"}"""))
		assertNull(SigninEnrollment.challenge(400, "{}")); assertNull(SigninEnrollment.challenge(200, "nope"))
		assertNotNull(SigninEnrollment.refusal(401)); assertEquals("", SigninEnrollment.refusal(201))
	}

	@Test fun theBodyCarriesTheCodeAndAShortLabel() {
		val j = JSONObject(SigninEnrollment.body("c", "dev_1", "pk", "sig", "x".repeat(300), "enr_a.b"))
		assertEquals("enr_a.b", j.getString("enrolmentCode")); assertEquals(100, j.getString("label").length)
		assertEquals("Android phone", JSONObject(SigninEnrollment.body("c", "d", "p", "s", "  ", "e")).getString("label"))
	}
}
