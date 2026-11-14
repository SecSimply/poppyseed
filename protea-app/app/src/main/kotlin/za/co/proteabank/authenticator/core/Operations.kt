package za.co.proteabank.authenticator.core

import org.json.JSONObject

/** One payment the bank is waiting on the phone to decide. */
data class PendingOperation(
	val id: String, val revision: Int, val state: String, val summary: String, val terms: Map<String, Any?>,
	val bankHash: String, val expiresAt: String?, val agentName: String?,
) {
	/** The hash this phone computes from the words and terms it will show. It is the one signed, never the bank's. */
	val hash: String? = try { Messages.termsHash(summary, terms) } catch (_: NotCanonical) { null }

	/** Whether what the bank sent matches the hash the bank sent with it. The phone approves nothing that does not. */
	val consistent: Boolean get() = hash != null && hash == bankHash

	val open: Boolean get() = state == "proposed"

	/** "ZAR 10.00", read from the terms, which are the same ones the approval covers. */
	val amount: String? get() = (terms["amount"] as? Map<*, *>)?.let { a -> "${a["currency"] ?: ""} ${a["amount"] ?: ""}".trim().ifEmpty { null } }
}

sealed interface Outcome {
	/** The bank performed the payment. */
	data object Approved : Outcome
	data object Declined : Outcome
	/** A newer version of the payment exists. Show it again and ask again. */
	data class Changed(val latest: PendingOperation?) : Outcome
	/** Already decided, or it expired. */
	data object NotOpen : Outcome
	/** The bank does not accept the app's sign-in: it ran out, or the phone was removed. The app locks and asks for the fingerprint again. */
	data object Locked : Outcome
	/** The bank refused the signature. */
	data object Refused : Outcome
	data object Gone : Outcome
	data class Failed(val text: String) : Outcome
}

object Operations {
	fun list(body: String): List<PendingOperation> = try {
		@Suppress("UNCHECKED_CAST")
		((parseJson(body) as Map<String, Any?>)["operations"] as List<Map<String, Any?>>).mapNotNull(::one)
	} catch (_: Exception) { emptyList() }

	fun one(m: Map<String, Any?>): PendingOperation? = try {
		@Suppress("UNCHECKED_CAST")
		PendingOperation(
			id = m["operation_id"] as String, revision = (m["revision"] as Number).toInt(), state = m["state"] as String,
			summary = m["summary"] as String, terms = m["terms"] as Map<String, Any?>, bankHash = m["terms_hash"] as String,
			expiresAt = m["expires_at"] as? String, agentName = (m["agent"] as? Map<String, Any?>)?.get("name") as? String,
		)
	} catch (_: Exception) { null }

	fun approveBody(revision: Int, approval: za.co.proteabank.authenticator.device.Approval): String = JSONObject()
		.put("revision", revision)
		.put("approval", JSONObject().put("signature", approval.signature).put("nonce", approval.nonce).put("time", approval.time))
		.toString()

	/** What happened to an approval or a decline, from the bank's answer. */
	fun outcome(approving: Boolean, status: Int, body: String): Outcome = when (status) {
		200 -> if (approving) Outcome.Approved else Outcome.Declined
		401 -> Outcome.Locked
		403 -> Outcome.Refused
		404 -> Outcome.Gone
		409 -> try {
			@Suppress("UNCHECKED_CAST")
			val j = parseJson(body) as Map<String, Any?>
			if (j["error"] == "terms_changed") Outcome.Changed((j["operation"] as? Map<String, Any?>)?.let(::one)) else Outcome.NotOpen
		} catch (_: Exception) { Outcome.NotOpen }
		else -> Outcome.Failed("The bank answered $status.")
	}
}
