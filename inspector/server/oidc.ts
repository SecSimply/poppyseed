/**
 * The Inspector's sign-in: the shared OpenID Connect flow, configured from OIDC_* variables, for an allow-list of
 * people. The flow itself lives in the `oidc-login` package, which Protea Bank uses too.
 */
import type { OidcConfig } from "oidc-login";

export { BadCallback, NotAllowed, Oidc, type OidcConfig, type OidcUser } from "oidc-login";

const list = (value?: string, lower = false) => new Set((value ?? "").split(",").map((v) => (lower ? v.trim().toLowerCase() : v.trim())).filter(Boolean));

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
