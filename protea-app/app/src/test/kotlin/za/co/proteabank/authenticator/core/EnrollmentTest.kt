package za.co.proteabank.authenticator.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EnrollmentTest {
	private val real = "protea://enroll?o=https%3A%2F%2Fapp.proteabank.co.za&e=enr_ExYPnjTs6rBe&s=IM-NRiWQkPCxmMHi57SIoY7-7Vrtom-X"
	private val link = EnrollmentLink.parse(real)!!
	private val jwk = Jwk("a".repeat(43), "b".repeat(43))

	@Test fun readsTheLinkTheBankShows() {
		assertEquals("https://app.proteabank.co.za", link.origin)
		assertEquals("enr_ExYPnjTs6rBe", link.enrollmentId)
		assertEquals("IM-NRiWQkPCxmMHi57SIoY7-7Vrtom-X", link.secret)
		assertEquals("app.proteabank.co.za", link.host)
	}

	@Test fun refusesAnythingElse() {
		val bad = listOf(
			"", "https://app.proteabank.co.za", "protea://other?o=https%3A%2F%2Fa.b&e=enr_x&s=y",
			"protea://enroll?o=http%3A%2F%2Fapp.proteabank.co.za&e=enr_x&s=y", // not https
			"protea://enroll?o=https%3A%2F%2Fapp.proteabank.co.za%2Fpath&e=enr_x&s=y", // origin with a path
			"protea://enroll?o=https%3A%2F%2Fuser%40app.proteabank.co.za&e=enr_x&s=y", // credentials in the origin
			"protea://enroll?o=https%3A%2F%2Fapp.proteabank.co.za&e=bad&s=y", "protea://enroll?o=https%3A%2F%2Fapp.proteabank.co.za&e=enr_x",
			"protea://enroll?o=https%3A%2F%2Fapp.proteabank.co.za&e=enr_x&s=has%20space",
		)
		for (b in bad) assertNull(b, EnrollmentLink.parse(b))
	}

	@Test fun keepsANonStandardPortInTheHost() {
		val l = EnrollmentLink.parse("protea://enroll?o=https%3A%2F%2Fbank.example%3A8443&e=enr_x&s=y")!!
		assertEquals("https://bank.example:8443", l.origin); assertEquals("bank.example:8443", l.host)
	}

	@Test fun theBodyNamesTheEnrollmentTheApprovalKeyAndANoLongerThanFortyCharacters() {
		val j = JSONObject(Enrollment.body(link, "x".repeat(60), Jwk("c".repeat(43), "d".repeat(43))))
		assertEquals("enr_ExYPnjTs6rBe", j.getString("enrollment_id")); assertEquals(40, j.getString("name").length)
		assertEquals("c".repeat(43), j.getJSONObject("approval_key").getString("x")); assertFalse(j.has("auth_key"))
		assertEquals("Android phone", JSONObject(Enrollment.body(link, "  ", jwk)).getString("name"))
	}

	@Test fun anAcceptedEnrollmentIsReadAndAnythingElseIsRefused() {
		val ok = """{"device_id":"dev_1","code":"074369","origin":"https://app.proteabank.co.za","customer":"Thandi Nkosi"}"""
		assertEquals(EnrollResult.Enrolled("dev_1", "074369", "Thandi Nkosi"), Enrollment.result(link, 201, ok))
		assertTrue(Enrollment.result(link, 400, """{"error":"invalid_enrollment"}""") is EnrollResult.Refused)
		assertTrue(Enrollment.result(link, 201, ok.replace("app.proteabank", "evil.example")) is EnrollResult.Refused) // a different bank answered
		assertTrue(Enrollment.result(link, 201, "not json") is EnrollResult.Refused)
		assertNotNull(Enrollment.result(link, 500, ""))
	}
}
