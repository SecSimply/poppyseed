import { describe, expect, it } from "vitest";
import { hintsFor } from "./hints.ts";

const json = (error: string, error_description?: string) => JSON.stringify({ error, error_description });

describe("hintsFor", () => {
	it("says nothing about a success", () => {
		expect(hintsFor(200, json("invalid_request"), {})).toEqual([]);
	});

	it("explains a refused DPoP proof and names the claim the description points at", () => {
		const hints = hintsFor(400, json("invalid_dpop_proof", "htu does not match the request URL"), {});
		expect(hints[0]).toMatch(/htu/);
		expect(hints.join(" ")).toMatch(/typ|jti|iat/);
	});

	it("explains a refused client assertion in terms of client_id and the JWKS", () => {
		expect(hintsFor(401, json("invalid_client", "aud must be this Company's issuer"), {}).join(" ")).toMatch(/client_id[\s\S]*JWKS|JWKS[\s\S]*client_id/);
	});

	it("tells a developer that a restarted agent's new keys may not be picked up straight away", () => {
		expect(hintsFor(401, json("invalid_client", "assertion signature or claims are invalid"), {}).join(" ")).toMatch(/restarted[\s\S]*cache[\s\S]*30 seconds/);
	});

	it("says a blocked agent is the company's decision, and does not send the developer to check keys", () => {
		const hints = hintsFor(401, json("invalid_client", "client is blocked"), {});
		expect(hints).toHaveLength(1);
		expect(hints[0]).toMatch(/blocked[\s\S]*company's decision/);
		expect(hints.join(" ")).not.toMatch(/JWKS|restarted/);
	});

	it("says an unregistered agent needs registering", () => {
		expect(hintsFor(401, json("invalid_client", "this personal agent is not registered with this company"), {}).join(" ")).toMatch(/clients\.allow[\s\S]*Ask the company to register/);
	});

	it("reads the error from WWW-Authenticate when the body has none", () => {
		expect(hintsFor(401, "", { "www-authenticate": 'DPoP error="invalid_token"' }).join(" ")).toMatch(/expired|revoked/);
	});

	it("treats authorization_pending as normal, not as a failure", () => {
		expect(hintsFor(400, json("authorization_pending"), {}).join(" ")).toMatch(/not a failure/i);
	});

	it("gives advice for a replayed jti", () => {
		expect(hintsFor(400, json("invalid_grant", "jti already used"), {}).join(" ")).toMatch(/fresh|new/);
	});

	it("stays quiet about an error it does not know, and about a body that is not JSON", () => {
		expect(hintsFor(400, json("something_new"), {})).toEqual([]);
		expect(hintsFor(502, "<html>bad gateway</html>", {})).toEqual([]);
	});

	it("does not repeat a hint", () => {
		const hints = hintsFor(400, json("invalid_grant", "aud and aud"), {});
		expect(new Set(hints).size).toBe(hints.length);
	});
});
