import { describe, expect, test } from "vitest";
import { oidcFromEnv } from "./oidc.ts";

describe("configuration", () => {
	const env = { OIDC_ISSUER: "https://curity.example/oauth/v2/oauth-anonymous", OIDC_CLIENT_ID: "inspector", OIDC_ALLOWED_SUBS: "Sub-A, sub-b" };
	test("is off without OIDC_ISSUER", () => expect(oidcFromEnv({}, "https://i.example")).toBeUndefined());
	test("requires an allow-list, a client id and an https issuer", () => {
		expect(() => oidcFromEnv({ ...env, OIDC_ALLOWED_SUBS: "" }, "https://i.example")).toThrow(/allow/i);
		expect(() => oidcFromEnv({ ...env, OIDC_CLIENT_ID: "" }, "https://i.example")).toThrow(/CLIENT_ID/);
		expect(() => oidcFromEnv({ ...env, OIDC_ISSUER: "http://curity.example" }, "https://i.example")).toThrow(/https/);
	});
	test("keeps subs as written, lowercases emails, and registers /auth/callback", () => {
		const c = oidcFromEnv({ ...env, OIDC_ALLOWED_EMAILS: "A@B.com" }, "https://i.example")!;
		expect([...c.allowedSubs!]).toEqual(["Sub-A", "sub-b"]);
		expect([...c.allowedEmails!]).toEqual(["a@b.com"]);
		expect(c.redirectUri).toBe("https://i.example/auth/callback");
	});
});
