package za.co.proteabank.authenticator.core

import java.net.URI
import java.security.SecureRandom
import java.util.Base64
import org.json.JSONObject

/** Where to register for signing in: the service's origin and the one-time code, both from the bank's answer to `POST /authenticator/signin-code`. */
data class SigninLink(val origin: String, val code: String) {
	companion object {
		private val codePattern = Regex("enr_[A-Za-z0-9_-]{1,60}\\.[A-Za-z0-9_-]{1,60}")

		/** The link if the answer is one this app accepts, or null. The service must be reached over https and the origin carries no path. */
		fun of(origin: String, code: String): SigninLink? {
			val u = try { URI(origin) } catch (_: Exception) { return null }
			if (u.scheme != "https" || u.host.isNullOrEmpty() || u.userInfo != null || (u.rawPath ?: "").trim('/').isNotEmpty() || u.rawQuery != null || u.rawFragment != null) return null
			if (code.length > 120 || !codePattern.matches(code)) return null
			return SigninLink("https://" + u.host.lowercase() + if (u.port != -1 && u.port != 443) ":${u.port}" else "", code)
		}

		/** Reads the bank's answer to the sign-in code request. */
		fun fromAnswer(status: Int, body: String): SigninLink? {
			if (status != 200) return null
			return try { JSONObject(body).let { of(it.getString("origin"), it.getString("code")) } } catch (_: Exception) { null }
		}
	}
}

/** The device auth service's registration, as `README.md` of that service writes it. Pure, so it is tested on the computer. */
object SigninEnrollment {
	/** 8 to 64 characters of `A-Za-z0-9_-`: a random id the phone makes for itself. */
	fun newDeviceId(): String = "dev_" + ByteArray(12).also { SecureRandom().nextBytes(it) }.let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }

	/** The bytes the key signs: `DEVAUTH-V1\n<purpose>\n<challenge>\n<deviceId>\n<audience>`. */
	fun message(purpose: String, challenge: String, deviceId: String, audience: String): String =
		"DEVAUTH-V1\n$purpose\n$challenge\n$deviceId\n$audience"

	fun challengeBody(deviceId: String): String = JSONObject().put("deviceId", deviceId).toString()

	/** The challenge, and the audience the service names. The audience is signed, so the signature is only good for this service. */
	data class Challenge(val value: String, val audience: String)

	fun challenge(status: Int, body: String): Challenge? {
		if (status != 200) return null
		return try { JSONObject(body).let { Challenge(it.getString("challenge"), it.getString("audience")) } } catch (_: Exception) { null }
	}

	/** `publicKey` is the base64 SubjectPublicKeyInfo and `signature` the base64 DER signature, both standard base64. */
	fun body(challenge: String, deviceId: String, publicKey: String, signature: String, label: String, code: String): String = JSONObject()
		.put("challenge", challenge).put("deviceId", deviceId).put("publicKey", publicKey).put("signature", signature)
		.put("label", label.trim().take(100).ifEmpty { "Android phone" }).put("enrolmentCode", code).toString()

	fun refusal(status: Int): String = when (status) {
		201 -> ""
		401 -> "The service did not accept this code. It may have expired or been used: show a new one on the Account page."
		409 -> "This phone is already registered."
		429 -> "Too many tries. Wait a minute and scan again."
		else -> "The service answered $status."
	}
}
