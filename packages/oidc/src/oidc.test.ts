import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BadCallback, NotAllowed, Oidc, type OidcConfig } from "./index.ts";

/** A stand-in for Curity: discovery, JWKS, and a token endpoint that enforces PKCE like a real provider does. */
let server: Server;
let issuer = "";
let signing: Awaited<ReturnType<typeof generateKeyPair>>;
const codes = new Map<string, { challenge: string; nonce: string; sub: string; email?: string; name?: string; emailVerified?: boolean; aud?: string; badNonce?: boolean }>();
const tokenRequests: { auth?: string; body: URLSearchParams }[] = [];

beforeAll(async () => {
	signing = await generateKeyPair("RS256");
	const jwk = { ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
	server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", issuer);
		const send = (status: number, body: unknown) => (response.writeHead(status, { "content-type": "application/json" }), response.end(JSON.stringify(body)));
		if (url.pathname === "/.well-known/openid-configuration") return send(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
		// The same issuer, served under another name: its endpoints are on this host's /entry, and one document names a different issuer.
		if (url.pathname === "/entry/.well-known/openid-configuration") return send(200, { issuer, authorization_endpoint: `${issuer}/entry/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
		if (url.pathname === "/other/.well-known/openid-configuration") return send(200, { issuer: `${issuer}/other`, authorization_endpoint: `${issuer}/other/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
		if (url.pathname === "/jwks") return send(200, { keys: [jwk] });
		if (url.pathname === "/token" && request.method === "POST") {
			let raw = "";
			request.on("data", (c) => (raw += c)).on("end", async () => {
				const body = new URLSearchParams(raw);
				tokenRequests.push({ auth: request.headers.authorization, body });
				const grant = codes.get(body.get("code") ?? "");
				codes.delete(body.get("code") ?? ""); // one use
				const verifier = body.get("code_verifier") ?? "";
				const pkceOk = grant && createHash("sha256").update(verifier).digest("base64url") === grant.challenge;
				if (!grant || !pkceOk || body.get("grant_type") !== "authorization_code") return send(400, { error: "invalid_grant" });
				const idToken = await new SignJWT({ nonce: grant.badNonce ? "other" : grant.nonce, ...(grant.email ? { email: grant.email } : {}), ...(grant.name ? { name: grant.name } : {}), ...(grant.emailVerified === undefined ? {} : { email_verified: grant.emailVerified }) })
					.setProtectedHeader({ alg: "RS256", kid: "k1" })
					.setIssuer(issuer)
					.setAudience(grant.aud ?? "inspector")
					.setSubject(grant.sub)
					.setIssuedAt()
					.setExpirationTime("5m")
					.sign(signing.privateKey);
				send(200, { id_token: idToken, access_token: "unused", token_type: "Bearer" });
			});
			return;
		}
		send(404, {});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	issuer = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const config = (over: Partial<OidcConfig> = {}): OidcConfig => ({
	issuer,
	clientId: "inspector",
	scopes: "openid email",
	redirectUri: "https://inspector.example/auth/callback",
	allowedSubs: new Set(["sub-1"]),
	allowedEmails: new Set(["dev@example.com"]),
	...over,
});

/** Plays the provider's authorize step: reads the request the inspector sent, issues a code for it. */
async function login(oidc: Oidc, grant: { sub: string; email?: string; name?: string; emailVerified?: boolean; aud?: string; badNonce?: boolean }, extra?: Record<string, string>) {
	const started = await oidc.begin(extra);
	const url = new URL(started.url);
	const q = url.searchParams;
	expect(url.origin + url.pathname).toBe(`${issuer}/authorize`);
	expect(q.get("response_type")).toBe("code");
	expect(q.get("code_challenge_method")).toBe("S256");
	expect(q.get("redirect_uri")).toBe("https://inspector.example/auth/callback");
	expect(q.get("scope")).toBe("openid email");
	const code = `code-${Math.random()}`;
	codes.set(code, { challenge: q.get("code_challenge")!, nonce: q.get("nonce")!, ...grant });
	expect(started.state).toBe(q.get("state"));
	return { code, state: started.state };
}
const callback = (p: Record<string, string>) => new URLSearchParams(p);
/** The browser that started the login, which holds its state in a cookie. */
const finish = (oidc: Oidc, p: Record<string, string>, cookie: string | null = p.state ?? null) => oidc.finish(callback(p), cookie ?? undefined);

describe("sign in with an OpenID Connect provider (authorization code + PKCE)", () => {
	test("signs in a person on the allow-list, by sub or by email", async () => {
		const oidc = new Oidc(config());
		expect(await finish(oidc, await login(oidc, { sub: "sub-1" }))).toEqual({ sub: "sub-1" });
		expect(await finish(oidc, await login(oidc, { sub: "other", email: "Dev@Example.com" }))).toEqual({ sub: "other", email: "Dev@Example.com" });
	});

	test("reads discovery at the entry address, so people are sent there, and still requires the configured issuer", async () => {
		const viaEntry = new Oidc(config({ entry: `${issuer}/entry` }));
		const started = new URL((await viaEntry.begin()).url);
		expect(started.origin + started.pathname).toBe(`${issuer}/entry/authorize`);
		// An entry whose document names another issuer is refused, not trusted.
		await expect(new Oidc(config({ entry: `${issuer}/other` })).begin()).rejects.toThrow(/issuer is/);
	});

	test("sends the PKCE verifier, and the client secret as HTTP Basic only for a confidential client", async () => {
		tokenRequests.length = 0;
		const publicClient = new Oidc(config());
		await finish(publicClient, await login(publicClient, { sub: "sub-1" }));
		expect(tokenRequests[0]!.auth).toBeUndefined();
		expect(tokenRequests[0]!.body.get("client_id")).toBe("inspector");
		expect(tokenRequests[0]!.body.get("code_verifier")!.length).toBeGreaterThanOrEqual(43);

		const confidential = new Oidc(config({ clientSecret: "s3cret" }));
		await finish(confidential, await login(confidential, { sub: "sub-1" }));
		expect(tokenRequests[1]!.auth).toBe(`Basic ${Buffer.from("inspector:s3cret").toString("base64")}`);
		expect(tokenRequests[1]!.body.has("client_id")).toBe(false);
	});

	test("refuses a signed-in person who is not on the allow-list", async () => {
		const oidc = new Oidc(config());
		await expect(finish(oidc, await login(oidc, { sub: "stranger", email: "x@example.com" }))).rejects.toBeInstanceOf(NotAllowed);
	});

	test("refuses an unknown, replayed or missing state", async () => {
		const oidc = new Oidc(config());
		const ok = await login(oidc, { sub: "sub-1" });
		await finish(oidc, ok);
		await expect(finish(oidc, ok)).rejects.toBeInstanceOf(BadCallback); // state is single-use
		await expect(finish(oidc, { code: "x", state: "never-issued" })).rejects.toBeInstanceOf(BadCallback);
		await expect(finish(oidc, { code: "x" }, "x")).rejects.toBeInstanceOf(BadCallback);
	});

	test("refuses a callback from a browser that did not start the login (login CSRF)", async () => {
		const oidc = new Oidc(config());
		// An allow-listed attacker starts a login in their own browser and gets a real code for it...
		const attackers = await login(oidc, { sub: "sub-1" });
		// ...then gets a victim's browser to open the callback. The victim has no login cookie, or one from another login.
		await expect(finish(oidc, attackers, null)).rejects.toThrow(/did not start/);
		const again = await login(oidc, { sub: "sub-1" });
		await expect(finish(oidc, again, "someone-elses-state")).rejects.toThrow(/did not start/);
	});

	test("never lets a flood of logins lock real logins out", async () => {
		const oidc = new Oidc(config());
		const real = await login(oidc, { sub: "sub-1" });
		for (let i = 0; i < 250; i++) await oidc.begin();
		await expect(finish(oidc, real)).rejects.toBeInstanceOf(BadCallback); // the oldest was evicted, not the newest
		const fresh = await login(oidc, { sub: "sub-1" });
		expect(await finish(oidc, fresh)).toEqual({ sub: "sub-1" });
	});

	test("refuses a provider error, a wrong iss, a wrong nonce and a wrong audience", async () => {
		const oidc = new Oidc(config());
		const denied = await login(oidc, { sub: "sub-1" });
		await expect(finish(oidc, { error: "access_denied", state: denied.state })).rejects.toBeInstanceOf(BadCallback);
		const wrongIss = await login(oidc, { sub: "sub-1" });
		await expect(finish(oidc, { ...wrongIss, iss: "https://evil.example" })).rejects.toBeInstanceOf(BadCallback);
		await expect(finish(oidc, await login(oidc, { sub: "sub-1", badNonce: true }))).rejects.toBeInstanceOf(BadCallback);
		await expect(finish(oidc, await login(oidc, { sub: "sub-1", aud: "someone-else" }))).rejects.toThrow();
	});

	test("lets any account sign in when there is no allow-list, and returns the name it was given", async () => {
		const oidc = new Oidc(config({ allowedSubs: undefined, allowedEmails: undefined }));
		expect(await finish(oidc, await login(oidc, { sub: "anyone", email: "a@example.com", name: "Thandi Nkosi" }))).toEqual({ sub: "anyone", email: "a@example.com", name: "Thandi Nkosi" });
		const empty = new Oidc(config({ allowedSubs: new Set(), allowedEmails: new Set() }));
		expect(await finish(empty, await login(empty, { sub: "anyone" }))).toEqual({ sub: "anyone" });
	});

	test("adds the extra request parameters it is given, such as prompt=login, and cannot be made to drop PKCE", async () => {
		const oidc = new Oidc(config());
		const started = await oidc.begin({ prompt: "login" });
		const q = new URL(started.url).searchParams;
		expect(q.get("prompt")).toBe("login");
		expect(q.get("code_challenge_method")).toBe("S256");
		expect(q.get("state")).toBe(started.state);
	});

	test("names its errors, so they can be told apart when the class is bundled twice", () => {
		expect(new BadCallback("x").name).toBe("BadCallback");
		expect(new NotAllowed("x").name).toBe("NotAllowed");
	});

	test("passes on whether the provider says the email is verified, and says nothing when it does not", async () => {
		const oidc = new Oidc(config({ allowedSubs: undefined, allowedEmails: undefined }));
		expect((await finish(oidc, await login(oidc, { sub: "a", email: "a@example.com", emailVerified: false }))).emailVerified).toBe(false);
		expect((await finish(oidc, await login(oidc, { sub: "b", email: "b@example.com", emailVerified: true }))).emailVerified).toBe(true);
		expect("emailVerified" in (await finish(oidc, await login(oidc, { sub: "c", email: "c@example.com" })))).toBe(false);
	});
});
