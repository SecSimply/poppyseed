package za.co.proteabank.authenticator.device

import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.util.Base64

sealed interface SigninSigned {
	/** Standard base64 of the DER signature, which is what the device auth service takes. */
	data class Signed(val signature: String) : SigninSigned
	data class NotSigned(val reason: String) : SigninSigned
	data object KeyLost : SigninSigned
}

object SigninSigner {
	/** Asks for the fingerprint, then signs `message` once with the sign-in key. `shown` tells the person what they are doing. */
	fun sign(activity: FragmentActivity, message: String, title: String, shown: String, onResult: (SigninSigned) -> Unit) {
		val signature = try { DeviceKeys.signinSignature() } catch (_: KeyPermanentlyInvalidatedException) { return onResult(SigninSigned.KeyLost) }
		val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
			override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
				try {
					val s = result.cryptoObject!!.signature!!
					s.update(message.toByteArray(Charsets.UTF_8))
					onResult(SigninSigned.Signed(Base64.getEncoder().encodeToString(s.sign())))
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
