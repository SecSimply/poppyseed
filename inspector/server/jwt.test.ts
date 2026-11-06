import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { inspectJwts, type RequestContext } from "./jwt.ts";

const NOW = 1_800_000_000_000;
const ISSUER = "https://company.example";
const URL_TOKEN = `${ISSUER}/oauth/token`;
const pair = await generateKeyPair("ES256", { extractable: true });
const publicJwk = await exportJWK(pair.publicKey);
const privateJwk = await exportJWK(pair.privateKey);

const proof = (claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
	new SignJWT({ htm: "POST", htu: URL_TOKEN, jti: "j".repeat(22), iat: NOW / 1000, ...claims }).setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: publicJwk, ...header }).sign(pair.privateKey);
const assertion = (claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
	new SignJWT({ iss: "https://agent.example/client.json", sub: "https://agent.example/client.json", aud: ISSUER, iat: NOW / 1000, exp: NOW / 1000 + 60, jti: "a".repeat(32), ...claims }).setProtectedHeader({ alg: "ES256", kid: "k1", ...header }).sign(pair.privateKey);

const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({ method: "POST", url: URL_TOKEN, headers: {}, body: "", contentType: "", at: NOW, issuer: ISSUER, ...over });
const failing = (jwts: ReturnType<typeof inspectJwts>) => jwts.flatMap((j) => j.checks.filter((c) => c.status === "fail").map((c) => `${j.kind}/${c.name}`));
const form = (fields: Record<string, string>) => ({ body: new URLSearchParams(fields).toString(), contentType: "application/x-www-form-urlencoded" });

describe("the proof a browser posts to join a Session", () => {
	it("is decoded and held to the DPoP rules, like one in a header", async () => {
		const joinUrl = `${ISSUER}/poppy/browser-session`;
		const jwts = inspectJwts(ctx({ url: joinUrl, ...form({ code: "bc_123", proof: await proof({ htu: joinUrl, nonce: "bc_123" }) }) }));
		expect(jwts).toHaveLength(1);
		expect(jwts[0]).toMatchObject({ where: "proof", kind: "DPoP proof" });
		expect(failing(jwts)).toEqual([]);
		expect(jwts[0]!.claims.nonce).toBe("bc_123");
	});
});

describe("DPoP proofs", () => {
	it("passes a valid proof on every check", async () => {
		const [jwt] = inspectJwts(ctx({ headers: { dpop: await proof() } }));
		expect(jwt?.kind).toBe("DPoP proof");
		expect(failing([jwt!])).toEqual([]);
	});

	it.each([
		["htu", { htu: "https://evil.example/token" }],
		["htm", { htm: "GET" }],
		["iat", { iat: NOW / 1000 - 3600 }],
		["jti", { jti: undefined }],
	])("fails a proof with a wrong %s", async (name, claims) => {
		expect(failing(inspectJwts(ctx({ headers: { dpop: await proof(claims) } })))).toEqual([`DPoP proof/${name}`]);
	});

	it("holds htu to the URL without its query", async () => {
		const jwts = inspectJwts(ctx({ url: `${URL_TOKEN}?x=1`, headers: { dpop: await proof() } }));
		expect(failing(jwts)).toEqual([]);
	});

	it("fails a wrong typ", async () => {
		expect(failing(inspectJwts(ctx({ headers: { dpop: await proof({}, { typ: "JWT" }) } })))).toEqual(["DPoP proof/typ"]);
	});

	it("checks ath against the access token sent with the proof", async () => {
		const token = "opaque-token-value";
		const ath = createHash("sha256").update(token).digest("base64url");
		const headers = (a: string) => ({ authorization: `DPoP ${token}`, dpop: a });
		expect(failing(inspectJwts(ctx({ headers: headers(await proof({ ath })) })))).toEqual([]);
		expect(failing(inspectJwts(ctx({ headers: headers(await proof({ ath: "wrong" })) })))).toEqual(["DPoP proof/ath"]);
		expect(failing(inspectJwts(ctx({ headers: headers(await proof()) })))).toEqual(["DPoP proof/ath"]);
	});

	it("reports a private key in the header, and never passes it on for display", async () => {
		const [jwt] = inspectJwts(ctx({ headers: { dpop: await proof({}, { jwk: privateJwk }) } }));
		expect(failing([jwt!])).toEqual(["DPoP proof/jwk"]);
		const shown = JSON.stringify(jwt);
		expect(shown).not.toContain(privateJwk.d);
		expect(shown).toContain(String(publicJwk.x));
	});
});

describe("assertions", () => {
	const send = (fields: Record<string, string>) => ctx({ ...form(fields) });

	it("passes a valid client assertion and a valid session assertion", async () => {
		const jwts = inspectJwts(send({ client_assertion: await assertion(), assertion: await assertion({ iss: "usr_1", sub: "usr_1" }) }));
		expect(jwts.map((j) => j.kind)).toEqual(["Client assertion", "Session assertion"]);
		expect(failing(jwts)).toEqual([]);
	});

	it("holds aud to the company's issuer, and does not accept an endpoint", async () => {
		expect(failing(inspectJwts(send({ client_assertion: await assertion({ aud: "https://elsewhere.example" }) })))).toEqual(["Client assertion/aud"]);
		expect(failing(inspectJwts(send({ client_assertion: await assertion({ aud: URL_TOKEN }) })))).toEqual(["Client assertion/aud"]);
	});

	it("fails a lifetime over five minutes and an expired assertion", async () => {
		expect(failing(inspectJwts(send({ client_assertion: await assertion({ exp: NOW / 1000 + 3600 }) })))).toEqual(["Client assertion/lifetime"]);
		expect(failing(inspectJwts(send({ assertion: await assertion({ iat: NOW / 1000 - 3600, exp: NOW / 1000 - 3540 }) })))).toEqual(["Session assertion/not expired"]);
	});

	it("fails an assertion that carries its own key, and one with a short jti", async () => {
		expect(failing(inspectJwts(send({ client_assertion: await assertion({}, { jwk: publicJwk }) })))).toEqual(["Client assertion/no embedded key"]);
		expect(failing(inspectJwts(send({ client_assertion: await assertion({ jti: "short" }) })))).toEqual(["Client assertion/jti"]);
	});

	it("checks the client assertion's subject against the request's client_id", async () => {
		const jwts = inspectJwts(send({ client_id: "https://other.example/c.json", client_assertion: await assertion() }));
		expect(failing(jwts)).toEqual(["Client assertion/sub = client_id"]);
	});

	it("falls back to the request's own origin for aud while the issuer is unknown", async () => {
		const jwts = inspectJwts({ ...send({ client_assertion: await assertion() }), issuer: undefined });
		expect(failing(jwts)).toEqual([]);
	});
});

describe("what leaves the server", () => {
	it("carries claims but never a signature or a whole token", async () => {
		const token = await proof();
		const jwts = inspectJwts(ctx({ headers: { dpop: token }, ...form({ client_assertion: await assertion() }) }));
		const shown = JSON.stringify(jwts);
		expect(shown).not.toContain(token.split(".")[2]!);
		expect(shown).not.toMatch(/eyJ[\w-]{6,}\.[\w-]{6,}/);
		expect(jwts.length).toBe(2);
	});

	it("reports a header that is not a JWT instead of ignoring it", () => {
		const [jwt] = inspectJwts(ctx({ headers: { dpop: "not-a-jwt" } }));
		expect(failing([jwt!])).toEqual(["DPoP proof/format"]);
	});

	it("finds nothing in a request without tokens", () => {
		expect(inspectJwts(ctx())).toEqual([]);
	});
});
