/**
 * A stand-in for Curity, for running the inspector locally with sign-in configured. It signs in ANYONE as
 * dev-user (dev@example.com) without asking for anything, so it must only ever run on your own machine.
 * It still enforces what a real provider does: the exact redirect_uri, PKCE S256, a single-use code, the nonce.
 *
 *   node --experimental-strip-types scripts/mock-oidc.ts            # http://localhost:3500
 *   OIDC_ISSUER=http://localhost:3500 OIDC_CLIENT_ID=inspector OIDC_ALLOWED_EMAILS=dev@example.com \
 *     INSPECTOR_PUBLIC_URL=http://localhost:3001 pnpm --filter poppyseed-inspector dev
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const port = Number(process.env.PORT ?? 3500);
const issuer = `http://localhost:${port}`;
const clientId = process.env.CLIENT_ID ?? "inspector";
const redirectUri = process.env.REDIRECT_URI ?? "http://localhost:3001/auth/callback";
/** Who the next sign-in is. Change it with GET /_as?sub=…&email=…&name=… (local use only), to play different people. */
const user: { sub: string; email: string; name?: string } = { sub: "dev-user", email: "dev@example.com" };
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "mock", alg: "RS256", use: "sig" };
const codes = new Map<string, { challenge: string; nonce: string }>();

createServer((request, response) => {
	const url = new URL(request.url ?? "/", issuer);
	const send = (status: number, body: unknown) => (response.writeHead(status, { "content-type": "application/json" }), response.end(JSON.stringify(body)));
	if (url.pathname === "/.well-known/openid-configuration") return send(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
	if (url.pathname === "/_as") {
		user.sub = url.searchParams.get("sub") ?? user.sub;
		user.email = url.searchParams.get("email") ?? user.email;
		user.name = url.searchParams.get("name") ?? undefined;
		return send(200, user);
	}
	if (url.pathname === "/jwks") return send(200, { keys: [jwk] });
	if (url.pathname === "/authorize") {
		const q = url.searchParams;
		if (q.get("client_id") !== clientId || q.get("redirect_uri") !== redirectUri || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return send(400, { error: "invalid_request" });
		const code = randomBytes(16).toString("hex");
		codes.set(code, { challenge: q.get("code_challenge")!, nonce: q.get("nonce") ?? "" });
		const back = new URL(redirectUri);
		back.search = new URLSearchParams({ code, state: q.get("state") ?? "", iss: issuer }).toString();
		response.writeHead(302, { location: back.toString() });
		return response.end();
	}
	if (url.pathname === "/token" && request.method === "POST") {
		let raw = "";
		request.on("data", (c) => (raw += c)).on("end", async () => {
			const body = new URLSearchParams(raw);
			const grant = codes.get(body.get("code") ?? "");
			codes.delete(body.get("code") ?? ""); // one use
			const pkce = grant && createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") === grant.challenge;
			if (!grant || !pkce || body.get("redirect_uri") !== redirectUri) return send(400, { error: "invalid_grant" });
			const idToken = await new SignJWT({ nonce: grant.nonce, email: user.email, ...(user.name ? { name: user.name } : {}) }).setProtectedHeader({ alg: "RS256", kid: "mock" }).setIssuer(issuer).setAudience(clientId).setSubject(user.sub).setIssuedAt().setExpirationTime("5m").sign(privateKey);
			send(200, { id_token: idToken, access_token: "unused", token_type: "Bearer" });
		});
		return;
	}
	send(404, {});
}).listen(port, "127.0.0.1", () => console.log(`[mock-oidc] ${issuer} (signs in anyone as ${user.email}; local use only)`));
