package za.co.proteabank.authenticator.store

import android.content.Context

/** Who this phone is enrolled as. Nothing secret: the keys are in the Keystore. */
data class Enrolled(val origin: String, val deviceId: String, val customer: String)

class DeviceStore(context: Context) {
	private val prefs = context.getSharedPreferences("protea_device", Context.MODE_PRIVATE)

	fun load(): Enrolled? {
		val origin = prefs.getString("origin", null) ?: return null
		val id = prefs.getString("device_id", null) ?: return null
		return Enrolled(origin, id, prefs.getString("customer", "") ?: "")
	}

	fun save(e: Enrolled) { prefs.edit().putString("origin", e.origin).putString("device_id", e.deviceId).putString("customer", e.customer).apply() }
	fun clear() { prefs.edit().clear().apply() }
}

/** The phone's registration with the device auth service, for signing in to the website. Nothing secret. */
data class SigninDevice(val origin: String, val deviceId: String)

class SigninStore(context: Context) {
	private val prefs = context.getSharedPreferences("protea_signin", Context.MODE_PRIVATE)
	fun load(): SigninDevice? = SigninDevice(prefs.getString("origin", null) ?: return null, prefs.getString("device_id", null) ?: return null)
	fun save(d: SigninDevice) { prefs.edit().putString("origin", d.origin).putString("device_id", d.deviceId).apply() }
	fun clear() { prefs.edit().clear().apply() }
}
