package za.co.proteabank.authenticator.device

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import za.co.proteabank.authenticator.core.Jwk
import za.co.proteabank.authenticator.core.Keys

/**
 * The phone's two keys, made in the Android Keystore (the secure hardware when there is one) and never taken out. Both are
 * unlocked by the fingerprint each time, with no time window, and stop working for good if a fingerprint is added.
 * The sign-in key signs in to the device auth service, which says who is in the app. The approval key signs one approval,
 * and the request for the sign-in code.
 */
object DeviceKeys {
	private const val APPROVAL = "protea_approval_key"
	private const val SIGNIN = "protea_signin_key"
	private const val PROVIDER = "AndroidKeyStore"

	private val store: KeyStore get() = KeyStore.getInstance(PROVIDER).apply { load(null) }

	fun exists(): Boolean = store.containsAlias(APPROVAL)

	/** Makes the approval key (replacing any), and returns its public half. */
	fun create(): Jwk {
		delete()
		generate(APPROVAL, userAuthentication = true)
		return approvalPublicKey()
	}

	fun approvalPublicKey(): Jwk = Keys.jwk(store.getCertificate(APPROVAL).publicKey)

	fun signinExists(): Boolean = store.containsAlias(SIGNIN)

	/** Makes the sign-in key for the device auth service (replacing any): fingerprint on every use, and it dies if a fingerprint is added. Returns the base64 SubjectPublicKeyInfo the service takes. */
	fun createSignin(): String {
		deleteSignin()
		generate(SIGNIN, userAuthentication = true)
		return java.util.Base64.getEncoder().encodeToString(store.getCertificate(SIGNIN).publicKey.encoded)
	}

	fun deleteSignin() { if (store.containsAlias(SIGNIN)) store.deleteEntry(SIGNIN) }

	/** A Signature ready for the sign-in key. It signs only after the fingerprint prompt unlocks it, or it throws. */
	fun signinSignature(): Signature =
		Signature.getInstance("SHA256withECDSA").apply { initSign(store.getKey(SIGNIN, null) as PrivateKey) }

	fun delete() {
		if (store.containsAlias(APPROVAL)) store.deleteEntry(APPROVAL)
	}

	/** A Signature ready for the approval key. It signs only after the fingerprint prompt unlocks it, or it throws. */
	fun approvalSignature(): Signature =
		Signature.getInstance("SHA256withECDSA").apply { initSign(store.getKey(APPROVAL, null) as PrivateKey) }

	/** Where each key lives, for the person to see: hardware level and whether the fingerprint is required. */
	fun describe(): List<String> = listOf(SIGNIN to "sign-in key", APPROVAL to "approval key").filter { store.containsAlias(it.first) }.map { (alias, label) ->
		val key = store.getKey(alias, null) as PrivateKey
		val info = KeyFactory.getInstance(key.algorithm, PROVIDER).getKeySpec(key, KeyInfo::class.java)
		val where = if (Build.VERSION.SDK_INT >= 31) when (info.securityLevel) {
			KeyProperties.SECURITY_LEVEL_STRONGBOX -> "StrongBox"
			KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "secure hardware (TEE)"
			else -> "software"
		} else if (info.isInsideSecureHardware) "secure hardware" else "software"
		"$label: $where, ${if (info.isUserAuthenticationRequired) "fingerprint required" else "no fingerprint"}"
	}

	private fun generate(alias: String, userAuthentication: Boolean) {
		fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
			.setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
			.setDigests(KeyProperties.DIGEST_SHA256)
			.apply {
				if (userAuthentication) {
					setUserAuthenticationRequired(true)
					if (Build.VERSION.SDK_INT >= 30) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
					else setUserAuthenticationValidityDurationSeconds(-1)
					setInvalidatedByBiometricEnrollment(true)
				}
				if (strongBox) setIsStrongBoxBacked(true)
			}
			.build()
		fun make(strongBox: Boolean) = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).apply { initialize(spec(strongBox)) }.generateKeyPair()
		try { make(strongBox = true) } catch (_: StrongBoxUnavailableException) { make(strongBox = false) }
	}
}
