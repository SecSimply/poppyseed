package za.co.proteabank.authenticator.core

import java.net.URI
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.Base64
import org.json.JSONObject

/** What the QR code under "Sign in with your phone" holds: `protea-device://enroll?o=<service origin>&c=<one-time code>`. */
data class SigninLink(val origin: String, val code: String) {
	companion object {
		private val codePattern = Regex("enr_[A-Za-z0-9_-]{1,60}\\.[A-Za-z0-9_-]{1,60}")

		/** The link if this app accepts it, or null. The service must be reached over https and the origin carries no path. */
		fun parse(text: String): SigninLink? {
			val uri = try { URI(text.trim()) } catch (_: Exception) { return null }
			if (uri.scheme != "protea-device" || uri.host != "enroll" || uri.rawQuery == null) return null
			val q = uri.rawQuery.split('&').mapNotNull {
				val i = it.indexOf('=')
				if (i < 1) null else it.substring(0, i) to URLDecoder.decode(it.substring(i + 1), "UTF-8")
			}.toMap()
			val origin = origin(q["o"] ?: return null) ?: return null
			val code = q["c"] ?: return null
			if (code.length > 120 || !codePattern.matches(code)) return null
			return SigninLink(origin, code)
		}

		private fun origin(value: String): String? {
			val u = try { URI(value) } catch (_: Exception) { return null }
			if (u.scheme != "https" || u.host.isNullOrEmpty() || u.userInfo != null || (u.rawPath ?: "").trim('/').isNotEmpty() || u.rawQuery != null || u.rawFragment != null) return null
			return "https://" + u.host.lowercase() + if (u.port != -1 && u.port != 443) ":${u.port}" else ""
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
