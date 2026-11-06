/**
 * Likely causes for a refusal. A debugger's job is to say what to look at next, so each code maps to the checks a
 * developer would make by hand. The wording follows what Poppyseed's own errors say; a description can narrow it.
 */

interface Refusal {
	status: number;
	error?: string;
	description?: string;
	wwwAuthenticate?: string;
}

const BY_CODE: Record<string, string[]> = {
	invalid_client: [
		"The client assertion was refused. Check that `client_id` is the exact HTTPS URL of your client metadata, and that the JWKS it points to holds the key that signed the assertion (same `kid`).",
		"The assertion's `iss` and `sub` must both equal `client_id`, and its `aud` must be the company's issuer.",
		"If the agent has just restarted, it made new keys but the company may still hold the old key set in its cache. Poppyseed refetches after a failed signature at most every 30 seconds, so wait that long and run again.",
	],
	invalid_grant: [
		"The grant was refused. For a session assertion: check `aud` (the company's issuer), `exp` (at most 5 minutes after `iat`), that `jti` has never been used before, and that the Agent ID matches the one this Session started with.",
		"For a device code or refresh token: it may have expired, been used already, or belong to another client or Session Key.",
	],
	invalid_request: ["A required parameter is missing or malformed. The description names which one; compare it with the form fields in the request."],
	unsupported_grant_type: ["The company does not offer this grant. Check `grant_types_supported` in its authorization server metadata."],
	invalid_scope: ["A scope was not recognised, or is wider than allowed. Compare with `scopes` in `/.well-known/poppy.json`."],
	invalid_target: ["The `resource` is not a service of this company. It must match a protected resource exactly (the MCP server URL, for instance)."],
	invalid_dpop_proof: [
		"The DPoP proof was refused. Open the proof in this request and check: `typ` is `dpop+jwt`, `htm` is the request method, `htu` is the URL without query or fragment, `iat` is current, `jti` is new.",
		"A proof must be signed by the key in its own `jwk` header, and that must be the key the token is bound to.",
	],
	use_dpop_nonce: ["The company wants a server-supplied nonce. Repeat the request with the nonce from the `DPoP-Nonce` response header in the proof."],
	invalid_token: [
		"The access token was not accepted. It may have expired, been revoked at sign-out, or been issued for another service: an MCP token only works at the MCP server.",
		"Check the `Authorization` scheme is `DPoP`, not `Bearer`, and that the proof's `ath` is the hash of this exact token.",
	],
	insufficient_scope: ["The token lacks a scope this call needs. Sign in with the scopes in the tool's description; a plain Session has none."],
	user_approval_required: ["This operation needs the person's own approval of this exact revision. An agent cannot confirm it for them."],
	terms_changed: ["The operation changed after it was proposed. Fetch it again and confirm the latest revision."],
	account_mismatch: ["This Session is signed in to a different account. Start a new Session."],
	authorization_pending: ["Expected while waiting for the person to approve. Not a failure: keep polling at the given interval."],
	slow_down: ["Polling too fast. Add 5 seconds to the interval."],
	expired_token: ["The device code expired before it was approved. Start the sign-in again."],
	access_denied: ["The person declined."],
	rate_limited: ["Too many requests. Wait for `Retry-After` before trying again."],
	not_found: ["Not found, or not yours: records belong to one client and person, and another's look the same as missing."],
};

const NARROW: [RegExp, string][] = [
	[/htu/i, "`htu` must be the request URL exactly, without query or fragment. Behind a proxy, check the public URL the company thinks it has."],
	[/htm/i, "`htm` must be the HTTP method of this request, in capitals."],
	[/\biat\b/i, "`iat` is outside the window. Check the agent's clock; Poppyseed accepts about 90 seconds either way."],
	[/typ/i, "The header `typ` must be exactly `dpop+jwt`."],
	[/\bjti\b.*(used|seen|replay)|replay/i, "This `jti` was already used. Every proof and assertion needs a fresh random `jti`."],
	[/aud/i, "`aud` must be the company's issuer as a single string, not an endpoint URL."],
	[/lifetime/i, "Keep `exp` within 5 minutes of `iat`."],
	[/own key|jwk|jku/i, "An assertion must not carry its own key. Sign it with a key published at your `jwks_uri`, and keep the DPoP key separate."],
	[/jwks|kid|signature/i, "The signature did not verify against your published JWKS. Check the `kid`, and that the JWKS the company fetched is current (it caches)."],
];

function parse(status: number, body: string | undefined, headers: Record<string, string>): Refusal {
	let error: string | undefined;
	let description: string | undefined;
	try {
		const json = JSON.parse(body ?? "") as Record<string, unknown>;
		if (typeof json.error === "string") error = json.error;
		if (typeof json.error_description === "string") description = json.error_description;
	} catch {
		/* not JSON */
	}
	const challenge = headers["www-authenticate"];
	// A resource server may say it only in the challenge: `DPoP error="invalid_token"`.
	error ??= challenge?.match(/error="([a-z_]+)"/)?.[1];
	return { status, error, description, wwwAuthenticate: challenge };
}

/**
 * A company that has chosen to refuse this agent says so in the description. No key, assertion or metadata change
 * helps, and the usual `invalid_client` advice would send a developer looking for a fault that is not there.
 */
const REFUSED_BY_CHOICE: [RegExp, string[]][] = [
	[/blocked/i, ["The company has blocked this agent by its `client_id` (`clients.block`). This is the company's decision, not a fault in your keys or metadata: nothing you change in the assertion will help. Ask the company to unblock the `client_id`."]],
	[/not registered/i, ["The company only accepts agents it has registered (`clients.allow`), and this `client_id` is not on its list. Ask the company to register it. Your keys and metadata are not the problem."]],
];

/** Likely causes for a response, or none when it was not a refusal or is not one the inspector knows. */
export function hintsFor(status: number, body: string | undefined, headers: Record<string, string>): string[] {
	if (status < 400) return [];
	const r = parse(status, body, headers);
	if (r.error === "invalid_client") {
		const chosen = REFUSED_BY_CHOICE.find(([pattern]) => pattern.test(r.description ?? ""));
		if (chosen) return chosen[1];
	}
	const out = r.error ? [...(BY_CODE[r.error] ?? [])] : [];
	// Narrower advice first: it names the thing in the description.
	const narrow = NARROW.filter(([pattern]) => pattern.test(r.description ?? "")).map(([, text]) => text);
	if (r.error === "authorization_pending" || r.error === "slow_down") return out;
	if (status === 429 && !out.length) out.push(...BY_CODE.rate_limited!);
	return [...new Set([...narrow, ...out])];
}
