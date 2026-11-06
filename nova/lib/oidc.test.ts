import { describe, expect, it } from "vitest";
import { oidcFromEnv } from "./oidc.ts";

const env = { OIDC_ISSUER: "https://idp.example/oauth/v2/oauth-anonymous", OIDC_CLIENT_ID: "protea-bank", OIDC_CLIENT_SECRET: "s" };

describe("sign-in configuration", () => {
	it("is off without OIDC_ISSUER", () => expect(oidcFromEnv({}, "https://bank.example")).toBeUndefined());

	it("needs a client id, a client secret and an https issuer", () => {
		expect(() => oidcFromEnv({ ...env, OIDC_CLIENT_ID: "" }, "https://bank.example")).toThrow(/CLIENT_ID/);
		expect(() => oidcFromEnv({ ...env, OIDC_CLIENT_SECRET: "" }, "https://bank.example")).toThrow(/CLIENT_SECRET/);
		expect(() => oidcFromEnv({ ...env, OIDC_ISSUER: "http://idp.example" }, "https://bank.example")).toThrow(/https/);
	});

	it("registers /auth/callback on the public address, and asks for the profile and email", () => {
		const c = oidcFromEnv(env, "https://bank.example")!;
		expect(c.redirectUri).toBe("https://bank.example/auth/callback");
		expect(c.scopes).toBe("openid profile email");
		expect(c.allowedSubs).toBeUndefined(); // any Curity user may sign in; lib/auth.ts decides what each may do
	});

	it("accepts the registered redirect address when it is this site's, and refuses one that could never work", () => {
		expect(oidcFromEnv({ ...env, OIDC_REDIRECT_URI: "https://bank.example/auth/callback" }, "https://bank.example")!.redirectUri).toBe("https://bank.example/auth/callback");
		for (const wrong of ["https://bank.railway.app/auth/callbank", "https://other.example/auth/callback", "https://bank.example/auth/callbank", "http://bank.example/auth/callback"]) {
			expect(() => oidcFromEnv({ ...env, OIDC_REDIRECT_URI: wrong }, "https://bank.example"), wrong).toThrow(/OIDC_REDIRECT_URI/);
		}
	});
});
