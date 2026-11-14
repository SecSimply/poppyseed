package za.co.proteabank.authenticator.core

import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The bank's own code wrote vectors.json (nova/scripts/authenticator-vectors.ts). The phone must agree with it byte for byte. */
class VectorsTest {
	@Suppress("UNCHECKED_CAST")
	private val vectors = parseJson(javaClass.getResource("/vectors.json")!!.readText()) as Map<String, Any?>
	@Suppress("UNCHECKED_CAST")
	private fun list(name: String) = vectors[name] as List<Map<String, Any?>>

	@Test fun canonicalJsonMatchesTheBank() {
		for (c in list("canonical")) assertEquals(c["canonical"], canonicalJson(c["input"]))
	}

	@Test fun termsHashMatchesTheBank() {
		for (o in list("operations")) {
			@Suppress("UNCHECKED_CAST")
			assertEquals(o["hash"], Messages.termsHash(o["summary"] as String, o["terms"] as Map<String, Any?>))
		}
	}

	@Test fun signinCodeMessageMatchesTheBank() {
		for (r in list("signinCodes")) assertEquals(r["message"], Messages.signinCode(r["origin"] as String, r["deviceId"] as String, r["nonce"] as String, r["time"] as String))
	}

	@Test fun approvalMessageMatchesTheBank() {
		for (a in list("approvals")) {
			assertEquals(a["message"], Messages.approval(a["origin"] as String, a["deviceId"] as String, a["operationId"] as String, (a["revision"] as Number).toInt(), a["termsHash"] as String, a["nonce"] as String, a["time"] as String))
		}
	}

	@Test fun verifiesTheBanksSignaturesInBothEncodings() {
		@Suppress("UNCHECKED_CAST")
		val s = vectors["signatures"] as Map<String, Any?>
		@Suppress("UNCHECKED_CAST")
		val j = s["jwk"] as Map<String, String>
		val jwk = Jwk(j["x"]!!, j["y"]!!)
		assertTrue(Keys.verify(jwk, s["message"] as String, s["der"] as String))
		assertTrue(Keys.verify(jwk, s["message"] as String, s["raw"] as String))
		assertFalse(Keys.verify(jwk, (s["message"] as String) + "x", s["der"] as String))
	}

	@Test fun aKeyRoundTripsThroughAJwk() {
		val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
		repeat(20) { // coordinates with a leading zero byte or a sign byte are the easy ones to get wrong
			val p = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
			val jwk = Keys.jwk(p.public)
			assertEquals(43, jwk.x.length); assertEquals(43, jwk.y.length)
			val sig = Signature.getInstance("SHA256withECDSA").run { initSign(p.private); update("hello".toByteArray()); sign() }
			assertTrue(Keys.verify(jwk, "hello", Keys.encode(sig)))
		}
		assertEquals(43, Keys.jwk(pair.public).x.length)
	}

	@Test fun refusesWhatItCannotWriteExactly() {
		assertThrows(NotCanonical::class.java) { canonicalJson(mapOf("n" to 1.5)) }
		assertThrows(NotCanonical::class.java) { canonicalJson(mapOf("n" to Any())) }
	}
}
