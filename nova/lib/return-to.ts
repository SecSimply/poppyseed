/**
 * Where to send a customer after sign-in. Only a path on this site is allowed: anything that resolves to another
 * origin (an absolute URL, `//host`, `/\host`, or an address that merely starts with this site's name) falls back.
 */
export function safeReturn(candidate: string | null | undefined, base: string, fallback = "/account"): string {
	if (!candidate) return fallback;
	try {
		const site = new URL(base);
		const target = new URL(candidate, site);
		if (target.origin !== site.origin) return fallback;
		return target.pathname + target.search;
	} catch {
		return fallback;
	}
}
