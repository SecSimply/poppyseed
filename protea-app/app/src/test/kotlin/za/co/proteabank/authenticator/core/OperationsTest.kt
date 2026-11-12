package za.co.proteabank.authenticator.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import za.co.proteabank.authenticator.device.Approval

class OperationsTest {
	private val summary = "Pay R10,00 to Boland Power (account ending 7741) from Everyday Cheque Account ••4821."
	private val terms = mapOf("payee_id" to "pye_thandi_energy", "from_account_id" to "acc_thandi_everyday", "amount" to mapOf("amount" to "10.00", "currency" to "ZAR"))
	private fun json(hash: String = Messages.termsHash(summary, terms), s: String = summary, state: String = "proposed") = JSONObject()
		.put("operation_id", "op_1").put("revision", 2).put("state", state).put("summary", s).put("terms", JSONObject(terms)).put("terms_hash", hash)
		.put("expires_at", "2026-11-12T16:00:00.000Z").put("agent", JSONObject().put("name", "Claude bridge")).toString()
	private fun list(vararg items: String) = """{"operations":[${items.joinToString(",")}]}"""

	@Test fun readsWhatTheBankSendsAndComputesItsOwnHash() {
		val op = Operations.list(list(json())).single()
		assertEquals("op_1", op.id); assertEquals(2, op.revision); assertEquals("Claude bridge", op.agentName); assertEquals("ZAR 10.00", op.amount)
		assertTrue(op.open); assertTrue(op.consistent); assertEquals(Messages.termsHash(summary, terms), op.hash)
	}

	@Test fun aRequestWhoseWordsDoNotMatchItsHashIsNeverConsistent() {
		val tampered = Operations.list(list(json(s = "Pay R10,00 to Someone Else"))).single() // the words changed, the bank's hash did not
		assertFalse(tampered.consistent)
		assertFalse(Operations.list(list(json(hash = "x"))).single().consistent)
	}

	@Test fun skipsWhatItCannotRead() {
		assertEquals(emptyList<PendingOperation>(), Operations.list("not json"))
		assertEquals(1, Operations.list(list("""{"operation_id":"x"}""", json())).size)
		assertFalse(Operations.list(list(json(state = "cancelled"))).single().open)
	}

	@Test fun theApprovalBodyCarriesTheRevisionAndTheSignature() {
		val j = JSONObject(Operations.approveBody(2, Approval("sig", "non", "123")))
		assertEquals(2, j.getInt("revision")); assertEquals("sig", j.getJSONObject("approval").getString("signature"))
		assertEquals("non", j.getJSONObject("approval").getString("nonce")); assertEquals("123", j.getJSONObject("approval").getString("time"))
	}

	@Test fun eachAnswerFromTheBankMeansOneThing() {
		assertEquals(Outcome.Approved, Operations.outcome(true, 200, "{}")); assertEquals(Outcome.Declined, Operations.outcome(false, 200, "{}"))
		assertEquals(Outcome.NotActive, Operations.outcome(true, 401, "{}")); assertEquals(Outcome.Refused, Operations.outcome(true, 403, "{}"))
		assertEquals(Outcome.Gone, Operations.outcome(true, 404, "{}"))
		assertEquals(Outcome.NotOpen, Operations.outcome(true, 409, """{"error":"not_open"}"""))
		val changed = Operations.outcome(true, 409, """{"error":"terms_changed","operation":${json()}}""") as Outcome.Changed
		assertEquals("op_1", changed.latest!!.id)
		assertTrue(Operations.outcome(true, 500, "") is Outcome.Failed)
		assertNull((Operations.outcome(true, 409, """{"error":"terms_changed"}""") as Outcome.Changed).latest)
	}
}
