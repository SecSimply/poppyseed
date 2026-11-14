package za.co.proteabank.authenticator.net

import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

data class HttpResult(val status: Int, val body: String)

/** Plain https, one request at a time, off the main thread. The answer comes back on the main thread. */
object Http {
	private val pool = Executors.newSingleThreadExecutor()
	private val main = Handler(Looper.getMainLooper())

	fun run(work: () -> HttpResult, done: (Result<HttpResult>) -> Unit) {
		pool.execute { val r = runCatching(work); main.post { done(r) } }
	}

	fun send(origin: String, method: String, target: String, body: String, headers: Map<String, String> = emptyMap()): HttpResult {
		val c = URL(origin + target).openConnection() as HttpURLConnection
		try {
			c.requestMethod = method; c.connectTimeout = 10_000; c.readTimeout = 15_000; c.instanceFollowRedirects = false
			headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
			if (body.isNotEmpty()) { c.doOutput = true; c.setRequestProperty("content-type", "application/json"); c.outputStream.use { it.write(body.toByteArray()) } }
			val status = c.responseCode
			val text = (if (status >= 400) c.errorStream else c.inputStream)?.use { String(it.readBytes()) } ?: ""
			return HttpResult(status, text)
		} finally { c.disconnect() }
	}

	/** A request that carries the device auth service's session, as every request after setup must: the bank asks the service whose it is. */
	fun bearer(origin: String, token: String, method: String, target: String, body: String = ""): HttpResult =
		send(origin, method, target, body, mapOf("authorization" to "Bearer $token"))
}
