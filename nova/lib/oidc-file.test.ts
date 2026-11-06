import { describe, expect, it } from "vitest";
import { forLocal, parseOidcFile } from "./oidc-file.ts";

const file = `# Protea Bank – Curity OIDC Client

| Client secret | \`s3cr3t-s3cr3t-s3cr3t-s3cr3t-0000000000000000\` |

## Application environment

\`\`\`
OIDC_ISSUER=https://idp.example/oauth/v2/oauth-anonymous
OIDC_CLIENT_ID=protea-bank
OIDC_CLIENT_SECRET=s3cr3t-s3cr3t-s3cr3t-s3cr3t-0000000000000000
OIDC_REDIRECT_URI=https://bank.example/auth/callback
\`\`\`
`;

describe("the Curity client file", () => {
	it("yields the four settings from its environment block", () => {
		expect(parseOidcFile(file)).toEqual({ OIDC_ISSUER: "https://idp.example/oauth/v2/oauth-anonymous", OIDC_CLIENT_ID: "protea-bank", OIDC_CLIENT_SECRET: "s3cr3t-s3cr3t-s3cr3t-s3cr3t-0000000000000000", OIDC_REDIRECT_URI: "https://bank.example/auth/callback" });
	});

	it("says what is missing", () => {
		expect(() => parseOidcFile("nothing here")).toThrow(/OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI/);
		expect(() => parseOidcFile(file.replace(/OIDC_CLIENT_ID=.*\n/, ""))).toThrow(/OIDC_CLIENT_ID/);
	});

	it("will not use a file whose issuer or secret does not look right", () => {
		expect(() => parseOidcFile(file.replace("https://idp", "http://idp"))).toThrow(/does not look right/);
		expect(() => parseOidcFile(file.replace(/OIDC_CLIENT_SECRET=\S+/, "OIDC_CLIENT_SECRET=short"))).toThrow(/does not look right/);
	});

	it("points a local run at localhost:3000, the redirect address Curity has registered for it", () => {
		const local = forLocal(parseOidcFile(file));
		expect(local.POPPYSEED_BASE_URL).toBe("http://localhost:3000");
		expect(local.OIDC_REDIRECT_URI).toBe("http://localhost:3000/auth/callback");
		expect(local.OIDC_CLIENT_ID).toBe("protea-bank");
	});
});
