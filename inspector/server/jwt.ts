import { createHash } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import type { Check, DecodedJwt } from "../shared/events.ts";

/** What is known about the request a JWT travelled in. `issuer` is the company's, once discovery has found it. */
export interface RequestContext {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string;
	contentType: string;
	/** When the request was sent, in ms. */
	at: number;
	issuer?: string;
}

// These follow the rules Poppyseed enforces: spec 4.2 for assertions, RFC 9449 for DPoP proofs.
const DPOP_IAT_WINDOW = 90;
const MAX_ASSERTION_LIFETIME = 300;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi"];

const pass = (name: string, detail: string): Check => ({ name, status: "pass", detail });
const fail = (name: string, detail: string): Check => ({ name, status: "fail", detail });
const info = (name: string, detail: string): Check => ({ name, status: "info", detail });
const check = (ok: boolean, name: string, good: string, bad: string): Check => (ok ? pass(name, good) : fail(name, bad));
const show = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : v === undefined ? "missing" : JSON.stringify(v));

const withoutQuery = (url: string) => {
	const u = new URL(url);
	u.search = "";
	u.hash = "";
	return u.toString();
};

function dpopChecks(header: Record<string, unknown>, claims: Record<string, unknown>, ctx: RequestContext): Check[] {
	const now = ctx.at / 1000;
	const checks: Check[] = [];
	checks.push(check(header.typ === "dpop+jwt", "typ", "dpop+jwt", `typ is ${show(header.typ)}; it must be "dpop+jwt"`));
	checks.push(check(header.alg === "ES256" || header.alg === "RS256", "alg", String(header.alg), `alg is ${show(header.alg)}; Poppy accepts ES256 or RS256`));
	const jwk = header.jwk as Record<string, unknown> | undefined;
	if (!jwk || typeof jwk !== "object") checks.push(fail("jwk", "the header carries no public key to verify the proof with"));
	else {
		const leaked = PRIVATE_MEMBERS.filter((m) => m in jwk);
		checks.push(leaked.length ? fail("jwk", `the header key includes private members (${leaked.join(", ")}): the private key has been disclosed`) : pass("jwk", "public key only"));
	}
	checks.push(check(claims.htm === ctx.method, "htm", `${ctx.method}, the request method`, `htm is ${show(claims.htm)}; this request is ${ctx.method}`));
	const htu = withoutQuery(ctx.url);
	checks.push(check(claims.htu === htu, "htu", "the request URL without query", `htu is ${show(claims.htu)}; this request went to ${htu}`));
	if (typeof claims.iat !== "number") checks.push(fail("iat", "missing"));
	else {
		const offset = Math.round(claims.iat - now);
		checks.push(check(Math.abs(offset) <= DPOP_IAT_WINDOW, "iat", `${offset} s from the send time`, `${offset} s from the send time; Poppyseed accepts ±${DPOP_IAT_WINDOW} s`));
	}
	checks.push(check(typeof claims.jti === "string" && claims.jti.length > 0, "jti", "present; it must never repeat for this key", "missing"));
	const authorization = ctx.headers.authorization;
	const token = /^dpop\s+(\S+)/i.exec(authorization ?? "")?.[1];
	if (token) {
		const expected = createHash("sha256").update(token).digest("base64url");
		checks.push(check(claims.ath === expected, "ath", "the hash of the access token sent with it", claims.ath === undefined ? "missing: a proof sent with an access token must carry its hash" : "does not match the hash of the access token in Authorization"));
	} else if (claims.ath !== undefined) checks.push(info("ath", "present, but no access token was sent"));
	else checks.push(info("ath", "not needed: no access token in this request"));
	return checks;
}

function assertionChecks(kind: "client" | "session", header: Record<string, unknown>, claims: Record<string, unknown>, ctx: RequestContext, clientId?: string): Check[] {
	const now = ctx.at / 1000;
	const checks: Check[] = [];
	checks.push(check(header.alg !== "none" && typeof header.alg === "string", "alg", String(header.alg), `alg is ${show(header.alg)}; an assertion must be signed`));
	const embedded = ["jwk", "jku", "x5u"].filter((m) => m in header);
	checks.push(embedded.length ? fail("no embedded key", `the header carries ${embedded.join(", ")}: sign with a key published at your jwks_uri instead`) : pass("no embedded key", "the key comes from the published JWKS"));
	checks.push(typeof header.kid === "string" ? info("kid", `${header.kid}: must be a key in your JWKS`) : info("kid", "none: the company must choose the key from your JWKS by other means"));
	const origin = new URL(ctx.url).origin;
	if (ctx.issuer) checks.push(check(claims.aud === ctx.issuer, "aud", `the company's issuer, ${ctx.issuer}`, `aud is ${show(claims.aud)}; it must be the issuer ${ctx.issuer}, as a single string, not an endpoint`));
	else checks.push(claims.aud === origin ? pass("aud", `${origin}`) : info("aud", `${show(claims.aud)}; this request went to ${origin}, whose issuer is not yet known`));
	if (kind === "client") {
		checks.push(check(claims.iss === claims.sub, "iss = sub", "both are the client_id", `iss is ${show(claims.iss)} and sub is ${show(claims.sub)}; for a client assertion both are the client_id`));
		if (clientId) checks.push(check(claims.sub === clientId, "sub = client_id", clientId, `sub is ${show(claims.sub)} but the request's client_id is ${clientId}`));
	} else checks.push(typeof claims.sub === "string" && claims.sub ? info("sub", `${claims.sub}: the User id this agent uses for this company`) : fail("sub", "missing"));
	if (typeof claims.iat === "number" && typeof claims.exp === "number") {
		const lifetime = claims.exp - claims.iat;
		checks.push(check(lifetime > 0 && lifetime <= MAX_ASSERTION_LIFETIME, "lifetime", `${lifetime} s`, `${lifetime} s; it must be positive and at most ${MAX_ASSERTION_LIFETIME} s`));
		checks.push(check(claims.exp > now, "not expired", `expires in ${Math.round(claims.exp - now)} s`, `expired ${Math.round(now - claims.exp)} s before it was sent`));
		if (claims.iat > now + 60) checks.push(fail("iat", `${Math.round(claims.iat - now)} s in the future`));
	} else checks.push(fail("iat / exp", "both are required"));
	checks.push(check(typeof claims.jti === "string" && claims.jti.length >= 16, "jti", "present and long enough (128 bits); each is accepted once", `jti is ${show(claims.jti)}; it must be at least 16 characters, and new every time`));
	return checks;
}

function decode(where: string, kind: DecodedJwt["kind"], jwt: string): Pick<DecodedJwt, "header" | "claims"> | DecodedJwt {
	try {
		return { header: decodeProtectedHeader(jwt) as Record<string, unknown>, claims: decodeJwt(jwt) as Record<string, unknown> };
	} catch {
		return { where, kind, header: {}, claims: {}, checks: [fail("format", "not a decodable JWT: it must be three base64url parts, with JSON in the first two")] };
	}
}

/** A header for display: the checks have seen the key, but private key material never goes to the browser. */
function displayHeader(header: Record<string, unknown>): Record<string, unknown> {
	const jwk = header.jwk;
	if (!jwk || typeof jwk !== "object") return header;
	return { ...header, jwk: Object.fromEntries(Object.entries(jwk).map(([k, v]) => [k, PRIVATE_MEMBERS.includes(k) ? "[private: not shown]" : v])) };
}

/** The JWTs a request carries, decoded and held to the rules the company applies. Never includes a signature. */
export function inspectJwts(ctx: RequestContext): DecodedJwt[] {
	const out: DecodedJwt[] = [];
	const found: { where: string; kind: DecodedJwt["kind"]; jwt: string }[] = [];
	if (ctx.headers.dpop) found.push({ where: "DPoP header", kind: "DPoP proof", jwt: ctx.headers.dpop });
	let form: URLSearchParams | undefined;
	if (ctx.contentType.includes("x-www-form-urlencoded")) form = new URLSearchParams(ctx.body);
	for (const [field, kind] of [["client_assertion", "Client assertion"], ["assertion", "Session assertion"], ["proof", "DPoP proof"]] as const) {
		const value = form?.get(field);
		if (value) found.push({ where: field, kind, jwt: value });
	}
	for (const { where, kind, jwt } of found) {
		const decoded = decode(where, kind, jwt);
		if ("checks" in decoded) {
			out.push(decoded);
			continue;
		}
		const { header, claims } = decoded;
		const checks = kind === "DPoP proof" ? dpopChecks(header, claims, ctx) : assertionChecks(kind === "Client assertion" ? "client" : "session", header, claims, ctx, form?.get("client_id") ?? undefined);
		out.push({ where, kind, header: displayHeader(header), claims, checks });
	}
	return out;
}
