package za.co.proteabank.authenticator.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NonceTest {
	@Test fun everyNonceIsNew() {
		val seen = (1..200).map { Nonce.make() }.toSet()
		assertEquals(200, seen.size)
		assertTrue(seen.all { it.length == 22 && !it.contains('=') })
		assertNotEquals(Nonce.make(), Nonce.make())
	}
}
