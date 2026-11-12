package za.co.proteabank.authenticator.core

import java.security.MessageDigest
import java.util.Base64

/** The texts the phone signs, built line by line the way the bank builds them (nova/lib/device-auth.ts and AUTHENTICATOR.md). */
object Messages {
	private val b64 = Base64.getUrlEncoder().withoutPadding()

	fun sha256(data: ByteArray): String = b64.encodeToString(MessageDigest.getInstance("SHA-256").digest(data))

	fun bodyHash(body: String): String = sha256(body.toByteArray(Charsets.UTF_8))

	/** What an approval covers: the words the customer reads and the terms behind them. */
	fun termsHash(summary: String, terms: Map<String, Any?>): String =
		sha256(canonicalJson(mapOf("summary" to summary, "terms" to terms)).toByteArray(Charsets.UTF_8))

	fun request(method: String, host: String, target: String, time: String, nonce: String, body: String): String =
		listOf("PROTEA-DEVICE-V1", method.uppercase(), host, target, time, nonce, bodyHash(body)).joinToString("\n")

	fun approval(origin: String, deviceId: String, operationId: String, revision: Int, termsHash: String, nonce: String, time: String): String =
		listOf("PROTEA-APPROVE-V1", origin, deviceId, operationId, revision.toString(), termsHash, nonce, time).joinToString("\n")
}
