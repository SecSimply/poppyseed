/**
 * Sign in to the inspector with an OpenID Connect provider (Curity): authorization code flow with PKCE (S256),
 * run by this server as a backend for the browser. The browser only ever holds an opaque session cookie; the
 * code, tokens and PKCE verifier stay here.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface OidcConfig {
	issuer: string;
	clientId: string;
	/** Set for a confidential client (client_secret_basic). Leave unset for a public client: PKCE alone then protects the code. */
	clientSecret?: string;
	scopes: string;
	redirectUri: string;
	/** Who may use the inspector. A valid Curity login is not enough: this is a tool that holds a live agent identity. */
	allowedSubs: Set<string>;
	allowedEmails: Set<string>;
}

export interface OidcUser {
	sub: string;
	email?: string;
}

/** The person signed in at the provider, but not allowed to use this inspector. */
export class NotAllowed extends Error {}
/** The sign-in response was not one this server started, or failed a check. */
export class BadCallback extends Error {}

const list = (value?: string, lower = false) => new Set((value ?? "").split(",").map((v) => (lower ? v.trim().toLowerCase() : v.trim())).filter(Boolean));
const b64url = (buffer: Buffer) => buffer.toString("base64url");
const TIMEOUT = 10_000;

/** Reads OIDC_* variables. Returns undefined when OIDC_ISSUER is not set; throws when it is set incompletely. */
export function oidcFromEnv(env: NodeJS.ProcessEnv, publicUrl: string): OidcConfig | undefined {
	const issuer = env.OIDC_ISSUER?.trim();
	if (!issuer) return undefined;
	const url = URL.parse(issuer);
	if (!url || (url.protocol !== "https:" && url.hostname !== "localhost")) throw new Error("OIDC_ISSUER must be an https:// URL");
	if (!env.OIDC_CLIENT_ID) throw new Error("Set OIDC_CLIENT_ID (the client registered in Curity)");
	const allowedSubs = list(env.OIDC_ALLOWED_SUBS);
	const allowedEmails = list(env.OIDC_ALLOWED_EMAILS, true);
	if (allowedSubs.size + allowedEmails.size === 0) throw new Error("Set OIDC_ALLOWED_SUBS or OIDC_ALLOWED_EMAILS: any account at the provider could otherwise use this inspector");
	return {
		issuer,
		clientId: env.OIDC_CLIENT_ID,
		clientSecret: env.OIDC_CLIENT_SECRET || undefined,
		scopes: env.OIDC_SCOPES?.trim() || "openid email",
		redirectUri: `${publicUrl}/auth/callback`,
		allowedSubs, // case-sensitive in OIDC, so kept as written
		allowedEmails,
	};
}

interface ProviderMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	jwks_uri: string;
}

interface Pending {
	verifier: string;
	nonce: string;
	expires: number;
}

export class Oidc {
	readonly config: OidcConfig;
	private pending = new Map<string, Pending>();
	private cached?: { metadata: ProviderMetadata; jwks: JWTVerifyGetKey; until: number };

	constructor(config: OidcConfig) {
		this.config = config;
	}

	private async provider() {
		if (this.cached && this.cached.until > Date.now()) return this.cached;
		const response = await fetch(`${this.config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT) });
		if (!response.ok) throw new Error(`discovery: HTTP ${response.status}`);
		const metadata = (await response.json()) as ProviderMetadata;
		if (metadata.issuer !== this.config.issuer) throw new Error(`discovery: issuer is ${metadata.issuer}, expected ${this.config.issuer}`);
		this.cached = { metadata, jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)), until: Date.now() + 3_600_000 };
		return this.cached;
	}

	/**
	 * Starts a login. `url` is where to send the browser; `state` must also be kept in a cookie on that browser, and
	 * handed back to `finish`, so a callback is only accepted from the browser that started the login.
	 */
	async begin(): Promise<{ url: string; state: string }> {
		const { metadata } = await this.provider();
		const now = Date.now();
		for (const [state, p] of this.pending) if (p.expires < now) this.pending.delete(state);
		// Anyone can start a login. Past the cap the oldest goes, so a flood can't lock real logins out.
		while (this.pending.size >= 200) this.pending.delete(this.pending.keys().next().value!);
		const state = b64url(randomBytes(24));
		const nonce = b64url(randomBytes(24));
		const verifier = b64url(randomBytes(32));
		this.pending.set(state, { verifier, nonce, expires: now + 600_000 });
		const url = new URL(metadata.authorization_endpoint);
		url.search = new URLSearchParams({
			response_type: "code",
			client_id: this.config.clientId,
			redirect_uri: this.config.redirectUri,
			scope: this.config.scopes,
			state,
			nonce,
			code_challenge: b64url(createHash("sha256").update(verifier).digest()),
			code_challenge_method: "S256",
		}).toString();
		return { url: url.toString(), state };
	}

	/**
	 * Finishes a login from the provider's redirect: checks that this browser started it (`browserState` is the cookie
	 * set at `begin`), exchanges the code with the PKCE verifier, and verifies the ID token.
	 */
	async finish(params: URLSearchParams, browserState: string | undefined): Promise<OidcUser> {
		const state = params.get("state") ?? "";
		const pending = this.pending.get(state);
		this.pending.delete(state); // one use
		if (!pending || pending.expires < Date.now()) throw new BadCallback("unknown or expired state");
		if (browserState === undefined || browserState !== state) throw new BadCallback("this browser did not start the login");
		if (params.get("error")) throw new BadCallback(`provider returned ${params.get("error")}`);
		const code = params.get("code");
		if (!code) throw new BadCallback("no code");
		const iss = params.get("iss"); // RFC 9207: present only if the provider sends it
		const { metadata, jwks } = await this.provider();
		if (iss && iss !== this.config.issuer) throw new BadCallback("iss does not match the issuer");

		const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri, code_verifier: pending.verifier });
		const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
		if (this.config.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`).toString("base64")}`;
		else body.set("client_id", this.config.clientId);
		const response = await fetch(metadata.token_endpoint, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(TIMEOUT) });
		if (!response.ok) throw new BadCallback(`token endpoint: HTTP ${response.status}`);
		const { id_token } = (await response.json()) as { id_token?: string };
		if (!id_token) throw new BadCallback("no id_token in the token response");

		const { payload } = await jwtVerify(id_token, jwks, { issuer: this.config.issuer, audience: this.config.clientId, algorithms: ["RS256", "PS256", "ES256"] });
		if (payload.nonce !== pending.nonce) throw new BadCallback("nonce mismatch");
		if (typeof payload.sub !== "string") throw new BadCallback("no sub");
		const email = typeof payload.email === "string" ? payload.email : undefined;
		const allowed = this.config.allowedSubs.has(payload.sub) || (email !== undefined && this.config.allowedEmails.has(email.toLowerCase()));
		if (!allowed) throw new NotAllowed(`sub ${payload.sub} is not on the allow-list`);
		return { sub: payload.sub, ...(email ? { email } : {}) };
	}
}
