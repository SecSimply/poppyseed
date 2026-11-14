package za.co.proteabank.authenticator.core

import java.security.SecureRandom
import java.util.Base64

/** A fresh random value for one approval or one code request. The bank accepts each once. */
object Nonce {
	private val random = SecureRandom()
	fun make(): String = ByteArray(16).also(random::nextBytes).let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
}
