/**
 * Reads the Curity client's details from the Markdown file that records them (nova/proteabankoidc.md, which is
 * git-ignored because it holds the client secret). The file has an "Application environment" block of `NAME=value`
 * lines; those are the settings the site needs. Used by scripts/oidc-env.ts, never by the running site.
 */
export const OIDC_NAMES = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI"] as const;
export type OidcName = (typeof OIDC_NAMES)[number];

export function parseOidcFile(text: string): Record<OidcName, string> {
	const found: Partial<Record<OidcName, string>> = {};
	for (const [, name, value] of text.matchAll(/^(OIDC_[A-Z_]+)=(\S+)\s*$/gm)) {
		if ((OIDC_NAMES as readonly string[]).includes(name!)) found[name as OidcName] = value!;
	}
	const missing = OIDC_NAMES.filter((n) => !found[n]);
	if (missing.length) throw new Error(`the file has no ${missing.join(", ")}: expected an "Application environment" block of NAME=value lines`);
	// A file that is not what it says (for example one whose text has been scrambled) must not be used for a secret.
	if (!/^https:\/\//.test(found.OIDC_ISSUER!) || /[\s`|<>]/.test(found.OIDC_CLIENT_SECRET!) || found.OIDC_CLIENT_SECRET!.length < 16) throw new Error("the file's issuer or client secret does not look right");
	return found as Record<OidcName, string>;
}

/** The same settings for a local `pnpm dev` on http://localhost:3000, which Curity has registered as a redirect address. */
export const forLocal = (settings: Record<OidcName, string>): Record<string, string> => ({
	POPPYSEED_BASE_URL: "http://localhost:3000",
	OIDC_ISSUER: settings.OIDC_ISSUER,
	OIDC_CLIENT_ID: settings.OIDC_CLIENT_ID,
	OIDC_CLIENT_SECRET: settings.OIDC_CLIENT_SECRET,
	OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
});
