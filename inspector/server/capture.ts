import type { Fetch } from "poppyseed/agent";
import type { HttpMessage, ProtocolEvent } from "../shared/events.ts";

const MAX_BODY = 64 * 1024;
const SECRET_HEADERS = new Set(["authorization", "dpop", "cookie", "set-cookie", "proxy-authorization"]);
const SECRET_FIELDS = new Set(["access_token", "refresh_token", "client_assertion", "assertion", "id_token", "device_code", "code", "password"]);
const JWT = /eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*/g;

const mask = (value: string) => `${value.slice(0, 12)}…[redacted ${value.length} chars]`;

/** Hides credentials in what the UI shows. The wire itself is untouched. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, SECRET_HEADERS.has(k.toLowerCase()) ? mask(v) : v.replace(JWT, mask)]));
}

export function redactBody(body: string, contentType: string): string {
	if (contentType.includes("json")) {
		try {
			const walk = (v: unknown): unknown => {
				if (Array.isArray(v)) return v.map(walk);
				if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_FIELDS.has(k) && typeof x === "string" ? mask(x) : walk(x)]));
				return typeof v === "string" ? v.replace(JWT, mask) : v;
			};
			return JSON.stringify(walk(JSON.parse(body)), null, 2);
		} catch {
			/* not JSON after all: fall through */
		}
	}
	if (contentType.includes("x-www-form-urlencoded")) {
		// One decoded field per line: easier to read than the percent-encoded wire form.
		return [...new URLSearchParams(body)].map(([k, v]) => `${k}=${SECRET_FIELDS.has(k) ? mask(v) : v.replace(JWT, mask)}`).join("\n");
	}
	return body.replace(JWT, mask);
}

async function message(headers: Headers, read: () => Promise<string>, redact: boolean): Promise<HttpMessage> {
	const raw = Object.fromEntries(headers);
	let body = "";
	try {
		body = await read();
	} catch {
		/* unreadable body (stream already used): show none */
	}
	const truncated = body.length > MAX_BODY;
	if (truncated) body = body.slice(0, MAX_BODY);
	const type = raw["content-type"] ?? "";
	return { headers: redact ? redactHeaders(raw) : raw, ...(body ? { body: redact ? redactBody(body, type) : body } : {}), ...(truncated ? { truncated } : {}) };
}

/** Wraps fetch so every request the agent makes is reported as an `http` event, tagged with the current step. */
export function capture(inner: Fetch, emit: (event: ProtocolEvent) => void, currentStep: () => string, redact: boolean): Fetch {
	return async (input, init) => {
		const request = new Request(input as RequestInfo, init);
		const started = Date.now();
		const requestMessage = await message(request.headers, () => request.clone().text(), redact);
		const base = { type: "http" as const, step: currentStep(), at: started, request: { method: request.method, url: request.url, ...requestMessage } };
		try {
			const response = await inner(input, init);
			const responseMessage = await message(response.headers, () => response.clone().text(), redact);
			emit({ ...base, ms: Date.now() - started, response: { status: response.status, ...responseMessage } });
			return response;
		} catch (error) {
			emit({ ...base, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	};
}
