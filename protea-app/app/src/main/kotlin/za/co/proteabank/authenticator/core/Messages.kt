package za.co.proteabank.authenticator.core

import java.security.MessageDigest
import java.util.Base64

/** The texts the phone signs, built line by line the way the bank builds them (nova/lib/device-auth.ts and AUTHENTICATOR.md). */
object Messages {
	private val b64 = Base64.getUrlEncoder().withoutPadding()

	fun sha256(data: ByteArray): String = b64.encodeToString(MessageDigest.getInstance("SHA-256").digest(data))

	/** What an approval covers: the words the customer reads and the terms behind them. */
	fun termsHash(summary: String, terms: Map<String, Any?>): String =
		sha256(canonicalJson(mapOf("summary" to summary, "terms" to terms)).toByteArray(Charsets.UTF_8))

	/** What the approval key signs to ask for the sign-in code: this bank, this phone, once. */
	fun signinCode(origin: String, deviceId: String, nonce: String, time: String): String =
		listOf("PROTEA-SIGNIN-CODE-V1", origin, deviceId, nonce, time).joinToString("\n")

	fun approval(origin: String, deviceId: String, operationId: String, revision: Int, termsHash: String, nonce: String, time: String): String =
		listOf("PROTEA-APPROVE-V1", origin, deviceId, operationId, revision.toString(), termsHash, nonce, time).joinToString("\n")
}
