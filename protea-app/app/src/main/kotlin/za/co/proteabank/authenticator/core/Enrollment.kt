package za.co.proteabank.authenticator.core

import org.json.JSONObject

/** The bank's answer to an enrollment. */
sealed interface EnrollResult {
	/** Enrolled, but not active until the customer presses "The codes match" on the website. */
	data class Enrolled(val deviceId: String, val code: String, val customer: String) : EnrollResult
	/** The bank said no, or said something this app does not trust. Every refusal reads the same on purpose. */
	data class Refused(val reason: String) : EnrollResult
}

object Enrollment {
	/** The body of `POST {origin}/authenticator/enroll`. `name` is 1 to 40 characters. */
	fun body(link: EnrollmentLink, name: String, approvalKey: Jwk): String = JSONObject()
		.put("enrollment_id", link.enrollmentId)
		.put("secret", link.secret)
		.put("name", name.trim().take(40).ifEmpty { "Android phone" })
		.put("approval_key", JSONObject(approvalKey.toMap()))
		.toString()

	/** Reads the answer. The bank's reply must name the origin the QR code named, or the phone does not trust it. */
	fun result(link: EnrollmentLink, status: Int, body: String): EnrollResult {
		if (status != 201) return EnrollResult.Refused("The bank did not accept this code. It may have expired or been used: show a new one on the Account page.")
		return try {
			val j = JSONObject(body)
			if (j.getString("origin") != link.origin) EnrollResult.Refused("The bank answered for a different address than the one on the QR code.")
			else EnrollResult.Enrolled(j.getString("device_id"), j.getString("code"), j.getString("customer"))
		} catch (_: Exception) {
			EnrollResult.Refused("The bank's answer was not what this app expects.")
		}
	}
}
