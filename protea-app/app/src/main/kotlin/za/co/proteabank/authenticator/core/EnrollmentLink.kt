package za.co.proteabank.authenticator.core

import java.net.URI
import java.net.URLDecoder

/** What the QR code on the bank's Account page holds: `protea://enroll?o=<bank origin>&e=<enrollment id>&s=<secret>`. */
data class EnrollmentLink(val origin: String, val enrollmentId: String, val secret: String) {
	/** The bank's host as it is signed in every request: the host, and the port only when it is not the standard one. */
	val host: String get() = hostOf(origin)

	companion object {
		/** The link if it is one this app accepts, or null. The bank must be reached over https, and the origin carries no path. */
		fun parse(text: String): EnrollmentLink? {
			val uri = try { URI(text.trim()) } catch (_: Exception) { return null }
			if (uri.scheme != "protea" || uri.host != "enroll" || uri.rawQuery == null) return null
			val q = uri.rawQuery.split('&').mapNotNull {
				val i = it.indexOf('=')
				if (i < 1) null else it.substring(0, i) to URLDecoder.decode(it.substring(i + 1), "UTF-8")
			}.toMap()
			val origin = originOf(q["o"] ?: return null) ?: return null
			val id = q["e"] ?: return null
			val secret = q["s"] ?: return null
			if (!Regex("enr_[A-Za-z0-9_-]{1,100}").matches(id) || !Regex("[A-Za-z0-9_-]{1,200}").matches(secret)) return null
			return EnrollmentLink(origin, id, secret)
		}

		private fun originOf(value: String): String? {
			val u = try { URI(value) } catch (_: Exception) { return null }
			if (u.scheme != "https" || u.host.isNullOrEmpty() || u.userInfo != null || (u.rawPath ?: "").trim('/').isNotEmpty() || u.rawQuery != null || u.rawFragment != null) return null
			return "https://" + u.host.lowercase() + if (u.port != -1 && u.port != 443) ":${u.port}" else ""
		}
	}
}

fun hostOf(origin: String): String = URI(origin).let { it.host + if (it.port != -1 && it.port != 443) ":${it.port}" else "" }
