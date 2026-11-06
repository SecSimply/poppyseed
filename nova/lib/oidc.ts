import { Oidc, type OidcConfig } from "oidc-login";
import { baseUrl, isBuild, secure } from "./env.ts";

type Env = Record<string, string | undefined>;

/**
 * Reads OIDC_* variables: OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET (the Curity client), and optionally
 * OIDC_SCOPES. Returns undefined when OIDC_ISSUER is not set; throws when it is set incompletely. Any account at the
 * provider may sign in; what each may do is decided by `lib/auth.ts`.
 */
export function oidcFromEnv(env: Env, publicUrl: string): OidcConfig | undefined {
	const issuer = env.OIDC_ISSUER?.trim();
	if (!issuer) return undefined;
	const url = URL.parse(issuer);
	if (!url || (url.protocol !== "https:" && url.hostname !== "localhost")) throw new Error("OIDC_ISSUER must be an https:// URL");
	if (!env.OIDC_CLIENT_ID) throw new Error("Set OIDC_CLIENT_ID (the client registered in Curity)");
	if (!env.OIDC_CLIENT_SECRET) throw new Error("Set OIDC_CLIENT_SECRET: Protea Bank is a confidential client");
	return {
		issuer,
		clientId: env.OIDC_CLIENT_ID,
		clientSecret: env.OIDC_CLIENT_SECRET,
		scopes: env.OIDC_SCOPES?.trim() || "openid profile email",
		redirectUri: `${publicUrl}/auth/callback`,
	};
}

declare global {
	var __proteaOidc: Oidc | undefined;
}

const config = oidcFromEnv(process.env, baseUrl);
// A deployed (https) site must sign people in through the provider: the demonstration login would let anyone be anyone.
if (secure && !config && !isBuild) throw new Error("Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET: a site served over https must sign people in with Curity");

/** One per process, because the login's state lives in it, and a page and a route can be bundled separately. */
export const oidc: Oidc | undefined = config && (globalThis.__proteaOidc ??= new Oidc(config));
