package za.co.proteabank.authenticator.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SigninEnrollmentTest {
	@Test fun readsTheBanksAnswer() {
		val l = SigninLink.fromAnswer(200, """{"origin":"https://DA.proteabank.co.za","code":"enr_AbC123_-x.Secret_part-9","expires_at":"2026-11-14T12:00:00.000Z"}""")!!
		assertEquals("https://da.proteabank.co.za", l.origin)
		assertEquals("enr_AbC123_-x.Secret_part-9", l.code)
	}

	@Test fun refusesAnythingElse() {
		val good = "enr_a.b"
		for (o in listOf("", "http://da.proteabank.co.za", "https://da.proteabank.co.za/x", "https://u@da.proteabank.co.za", "https://da.proteabank.co.za?x=1", "da.proteabank.co.za")) assertNull(o, SigninLink.of(o, good))
		for (c in listOf("", "nodot", "enr_a.", "enr_.b", "x_a.b", "enr_a.b c", "enr_a.b".padEnd(130, 'x'))) assertNull(c, SigninLink.of("https://da.proteabank.co.za", c))
		assertNull(SigninLink.fromAnswer(409, """{"origin":"https://da.proteabank.co.za","code":"enr_a.b"}"""))
		assertNull(SigninLink.fromAnswer(200, "nope")); assertNull(SigninLink.fromAnswer(200, """{"origin":"https://da.proteabank.co.za"}"""))
	}

	@Test fun keepsANonStandardPort() {
		assertEquals("https://da.example:8443", SigninLink.of("https://da.example:8443", "enr_a.b")!!.origin)
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
