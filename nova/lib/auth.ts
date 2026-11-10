import type { OidcUser } from "oidc-login";
import type { Links } from "./links.ts";
import type { Session } from "./session.ts";

type Env = Record<string, string | undefined>;

/** Emails separated by commas or spaces, lowercased. */
export const parseEmails = (text: string | undefined): Set<string> => new Set((text ?? "").split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));

/**
 * The session for someone who has just signed in at the provider. Which customer they are is not in the session: the
 * link table says, on every request, so unlinking takes effect at once. A login with no link is noted as pending for
 * staff to link; until then it signs in and sees no accounts. Staff is who STAFF_EMAILS lists, which is empty unless
 * someone edits it, so a customer's login never opens the support console.
 */
export async function sessionFor(user: OidcUser, links: Links, env: Env = process.env): Promise<Session> {
	const who = { sub: user.sub, ...(user.email ? { email: user.email } : {}), ...(user.name ? { name: user.name } : {}) };
	if (!(await links.customerFor(user.sub))) await links.notePending(who);
	// TEMPORARY: STAFF_TRUST_UNVERIFIED=1 lets an unverified email be staff, because Curity does not set email_verified yet. Anyone who can register a Curity login with a staff address would get the console and may link logins to customers. Delete the variable once Curity verifies emails.
	const trustUnverified = env.STAFF_TRUST_UNVERIFIED === "1";
	const verifiedEmail = user.emailVerified === false && !trustUnverified ? undefined : user.email?.toLowerCase();
	return { ...who, staff: verifiedEmail !== undefined && parseEmails(env.STAFF_EMAILS).has(verifiedEmail) };
}
