package za.co.proteabank.authenticator.device

import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.Signature
import java.util.Base64
import za.co.proteabank.authenticator.core.Keys

sealed interface SigninSigned {
	/** The DER signature the key made. The device auth service takes it as standard base64, the bank as base64url. */
	data class Signed(val der: ByteArray) : SigninSigned {
		val standard: String get() = Base64.getEncoder().encodeToString(der)
		val url: String get() = Keys.encode(der)
	}
	data class NotSigned(val reason: String) : SigninSigned
	data object KeyLost : SigninSigned
}

/** Which key signs: the sign-in key (for the device auth service) or the approval key (for the bank). Each needs the fingerprint. */
enum class SignWith { SIGNIN, APPROVAL }

object SigninSigner {
	/** Asks for the fingerprint, then signs `message` once with the chosen key. `shown` tells the person what they are doing. */
	fun sign(activity: FragmentActivity, with: SignWith, message: String, title: String, shown: String, onResult: (SigninSigned) -> Unit) {
		val signature: Signature = try {
			if (with == SignWith.SIGNIN) DeviceKeys.signinSignature() else DeviceKeys.approvalSignature()
		} catch (_: KeyPermanentlyInvalidatedException) { return onResult(SigninSigned.KeyLost) }
		val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
			override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
				try {
					val s = result.cryptoObject!!.signature!!
					s.update(message.toByteArray(Charsets.UTF_8))
					onResult(SigninSigned.Signed(s.sign()))
				} catch (e: Exception) { onResult(SigninSigned.NotSigned("could not sign: ${e.message}")) }
			}
			override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onResult(SigninSigned.NotSigned(errString.toString()))
		})
		prompt.authenticate(
			BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(shown)
				.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG).setNegativeButtonText("Cancel").build(),
			BiometricPrompt.CryptoObject(signature),
		)
	}
}
