package za.co.proteabank.authenticator.core

import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64

/** A P-256 public key in the form the bank takes: `{"kty":"EC","crv":"P-256","x":…,"y":…}`, with 43-character coordinates. */
data class Jwk(val x: String, val y: String) {
	fun toMap(): Map<String, Any?> = mapOf("kty" to "EC", "crv" to "P-256", "x" to x, "y" to y)
}

object Keys {
	private val enc = Base64.getUrlEncoder().withoutPadding()
	private val dec = Base64.getUrlDecoder()

	private val p256: ECParameterSpec by lazy {
		AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }.getParameterSpec(ECParameterSpec::class.java)
	}

	private fun coordinate(n: BigInteger): String {
		val raw = n.toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it } // drop the sign byte
		val padded = ByteArray(32).also { raw.copyInto(it, 32 - raw.size) }
		return enc.encodeToString(padded)
	}

	fun jwk(key: PublicKey): Jwk {
		val point = (key as ECPublicKey).w
		return Jwk(coordinate(point.affineX), coordinate(point.affineY))
	}

	fun publicKey(jwk: Jwk): PublicKey =
		KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(BigInteger(1, dec.decode(jwk.x)), BigInteger(1, dec.decode(jwk.y))), p256))

	fun encode(signature: ByteArray): String = enc.encodeToString(signature)

	/** Whether `signature` (the 64 bytes r‖s, or DER, base64url) is the key's ECDSA P-256 SHA-256 signature of `message`. Used by tests. */
	fun verify(jwk: Jwk, message: String, signature: String): Boolean = try {
		val raw = dec.decode(signature)
		val der = if (raw.size == 64) rawToDer(raw) else raw
		Signature.getInstance("SHA256withECDSA").run {
			initVerify(publicKey(jwk))
			update(message.toByteArray(Charsets.UTF_8))
			verify(der)
		}
	} catch (_: Exception) {
		false
	}

	private fun rawToDer(raw: ByteArray): ByteArray {
		fun int(b: ByteArray): ByteArray {
			var i = 0
			while (i < b.size - 1 && b[i] == 0.toByte()) i++
			val v = b.copyOfRange(i, b.size)
			val body = if (v[0] < 0) byteArrayOf(0) + v else v
			return byteArrayOf(0x02, body.size.toByte()) + body
		}
		val r = int(raw.copyOfRange(0, 32)); val s = int(raw.copyOfRange(32, 64))
		return byteArrayOf(0x30, (r.size + s.size).toByte()) + r + s
	}
}
