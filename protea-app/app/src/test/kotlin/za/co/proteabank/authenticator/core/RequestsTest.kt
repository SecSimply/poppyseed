package za.co.proteabank.authenticator.core

import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestsTest {
	private val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
	private val sign = { m: ByteArray -> Signature.getInstance("SHA256withECDSA").run { initSign(pair.private); update(m); sign() } }

	@Test fun theHeadersCarryTheDeviceTheTimeTheNonceAndASignatureTheBankCanCheck() {
		val h = Requests.headers("dev_1", "get", "app.proteabank.co.za", "/authenticator/operations", "", sign, now = 1731254400000, nonce = "abc")
		assertEquals(setOf("x-device-id", "x-device-time", "x-device-nonce", "x-device-signature"), h.keys)
		assertEquals("dev_1", h["x-device-id"]); assertEquals("1731254400000", h["x-device-time"]); assertEquals("abc", h["x-device-nonce"])
		val text = Messages.request("GET", "app.proteabank.co.za", "/authenticator/operations", "1731254400000", "abc", "")
		assertTrue(Keys.verify(Keys.jwk(pair.public), text, h["x-device-signature"]!!))
		assertTrue(!Keys.verify(Keys.jwk(pair.public), text + "x", h["x-device-signature"]!!))
	}

	@Test fun everyNonceIsNew() {
		val seen = (1..200).map { Nonce.make() }.toSet()
		assertEquals(200, seen.size)
		assertTrue(seen.all { it.length == 22 && !it.contains('=') })
		assertNotEquals(Nonce.make(), Nonce.make())
	}
}
