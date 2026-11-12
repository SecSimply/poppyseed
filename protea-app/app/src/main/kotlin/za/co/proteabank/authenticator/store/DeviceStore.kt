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
