package za.co.proteabank.authenticator.core

import java.security.SecureRandom
import java.util.Base64

/** A fresh random value for one request or one approval. The bank accepts each once. */
object Nonce {
	private val random = SecureRandom()
	fun make(): String = ByteArray(16).also(random::nextBytes).let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
}

object Requests {
	/**
	 * The four headers every request except enrollment carries. `sign` is the auth key: it signs the bytes of the text and returns the
	 * signature (DER, as Android's Signature gives it).
	 */
	fun headers(
		deviceId: String, method: String, host: String, target: String, body: String,
		sign: (ByteArray) -> ByteArray, now: Long = System.currentTimeMillis(), nonce: String = Nonce.make(),
	): Map<String, String> {
		val time = now.toString()
		val message = Messages.request(method, host, target, time, nonce, body)
		return mapOf(
			"x-device-id" to deviceId,
			"x-device-time" to time,
			"x-device-nonce" to nonce,
			"x-device-signature" to Keys.encode(sign(message.toByteArray(Charsets.UTF_8))),
		)
	}
}
