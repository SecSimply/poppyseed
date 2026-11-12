package za.co.proteabank.authenticator.core

import org.json.JSONArray
import org.json.JSONObject

/** Thrown for a value the phone cannot write exactly as the bank does. The phone then refuses to sign. */
class NotCanonical(message: String) : Exception(message)

/**
 * JSON with every object's keys in order and no spaces, written exactly as the bank's `canonicalJson` writes it (keys sorted by UTF-16
 * code unit, strings as JavaScript's `JSON.stringify` writes them). A number that is not a whole number is refused: the bank's terms
 * carry amounts as strings, and a float could be written differently on each side.
 */
fun canonicalJson(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

/** Parses JSON text into maps, lists, strings, numbers, booleans and null. */
fun parseJson(text: String): Any? = fromOrg(org.json.JSONTokener(text).nextValue())

private fun fromOrg(v: Any?): Any? = when (v) {
	null, JSONObject.NULL -> null
	is JSONObject -> LinkedHashMap<String, Any?>().also { m -> v.keys().forEach { k -> m[k] = fromOrg(v.get(k)) } }
	is JSONArray -> List(v.length()) { fromOrg(v.get(it)) }
	else -> v
}

private fun write(out: StringBuilder, value: Any?) {
	when (value) {
		null -> out.append("null")
		is Boolean -> out.append(value.toString())
		is String -> quote(out, value)
		is Int, is Long, is Short, is Byte -> out.append((value as Number).toLong())
		is Number -> {
			val d = value.toDouble()
			if (d != Math.floor(d) || Math.abs(d) > 9007199254740991.0) throw NotCanonical("a number the phone cannot write exactly: $value")
			out.append(d.toLong())
		}
		is Map<*, *> -> {
			out.append('{')
			value.keys.map { it as? String ?: throw NotCanonical("a key that is not text") }.sorted().forEachIndexed { i, k ->
				if (i > 0) out.append(',')
				quote(out, k)
				out.append(':')
				write(out, value[k])
			}
			out.append('}')
		}
		is List<*> -> {
			out.append('[')
			value.forEachIndexed { i, v -> if (i > 0) out.append(','); write(out, v) }
			out.append(']')
		}
		else -> throw NotCanonical("a value of a kind the phone does not write: ${value::class.simpleName}")
	}
}

private fun quote(out: StringBuilder, s: String) {
	out.append('"')
	var i = 0
	while (i < s.length) {
		val c = s[i]
		when {
			c == '"' -> out.append("\\\"")
			c == '\\' -> out.append("\\\\")
			c == '\b' -> out.append("\\b")
			c == '\u000C' -> out.append("\\f")
			c == '\n' -> out.append("\\n")
			c == '\r' -> out.append("\\r")
			c == '\t' -> out.append("\\t")
			c < ' ' -> out.append("\\u").append("%04x".format(c.code))
			c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> { out.append(c).append(s[i + 1]); i++ }
			c.isSurrogate() -> out.append("\\u").append("%04x".format(c.code)) // a lone surrogate, as JSON.stringify escapes it
			else -> out.append(c)
		}
		i++
	}
	out.append('"')
}
