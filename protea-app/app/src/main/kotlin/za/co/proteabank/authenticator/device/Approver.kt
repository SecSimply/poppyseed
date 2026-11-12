package za.co.proteabank.authenticator.device

import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import za.co.proteabank.authenticator.core.Keys
import za.co.proteabank.authenticator.core.Messages
import za.co.proteabank.authenticator.core.Nonce

/** What the bank takes as an approval: the approval key's signature, and the nonce and time it covers. */
data class Approval(val signature: String, val nonce: String, val time: String)

sealed interface ApprovalResult {
	data class Signed(val approval: Approval) : ApprovalResult
	/** The person cancelled or the fingerprint did not match. Nothing was signed. */
	data class NotApproved(val reason: String) : ApprovalResult
	/** The fingerprints on the phone changed, so the key stopped working for good. The phone must be enrolled again. */
	data object KeyLost : ApprovalResult
}

object Approver {
	/** Whether the phone can ask for a fingerprint at all. */
	fun canAuthenticate(activity: FragmentActivity): Boolean =
		BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

	/**
	 * Asks for the fingerprint, then signs this one approval. `shown` is the text the person is looking at, so the prompt can repeat
	 * it. The message signed is built here from the arguments, never taken from the bank, so the signature covers exactly them.
	 */
	fun approve(
		activity: FragmentActivity, origin: String, deviceId: String, operationId: String, revision: Int, termsHash: String, shown: String,
		onResult: (ApprovalResult) -> Unit,
	) {
		val nonce = Nonce.make()
		val time = System.currentTimeMillis().toString()
		val message = Messages.approval(origin, deviceId, operationId, revision, termsHash, nonce, time).toByteArray(Charsets.UTF_8)
		val signature = try { DeviceKeys.approvalSignature() } catch (_: KeyPermanentlyInvalidatedException) { return onResult(ApprovalResult.KeyLost) }
		val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
			override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
				try {
					val s = result.cryptoObject!!.signature!!
					s.update(message)
					onResult(ApprovalResult.Signed(Approval(Keys.encode(s.sign()), nonce, time)))
				} catch (e: Exception) {
					onResult(ApprovalResult.NotApproved("could not sign: ${e.message}"))
				}
			}
			override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onResult(ApprovalResult.NotApproved(errString.toString()))
		})
		prompt.authenticate(
			BiometricPrompt.PromptInfo.Builder()
				.setTitle("Approve this payment")
				.setSubtitle(shown)
				.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
				.setNegativeButtonText("Cancel")
				.build(),
			BiometricPrompt.CryptoObject(signature),
		)
	}
}
