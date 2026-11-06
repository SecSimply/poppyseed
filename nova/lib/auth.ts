import type { OidcUser } from "oidc-login";
import { customerById } from "./customers.ts";
import type { Session } from "./session.ts";

type Env = Record<string, string | undefined>;

/** `email=customer_id` pairs separated by commas or spaces: which Curity user is which customer. Emails match without regard to case. */
export function parseCustomerEmails(text: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	for (const pair of (text ?? "").split(/[\s,]+/)) {
		const at = pair.lastIndexOf("=");
		if (at > 0) map.set(pair.slice(0, at).toLowerCase(), pair.slice(at + 1));
	}
	return map;
}

/** Emails separated by commas or spaces, lowercased. */
export const parseEmails = (text: string | undefined): Set<string> => new Set((text ?? "").split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));

/**
 * The session for someone who has just signed in at the provider. A customer is who CUSTOMER_EMAILS says; anyone else
 * signs in and sees no accounts. Staff is who STAFF_EMAILS lists, which is empty unless someone edits it, so a
 * customer's login never opens the support console.
 */
export function sessionFor(user: OidcUser, env: Env = process.env): Session {
	// TEMPORARY: customers are matched on email even when the provider says it is unverified (Curity's email_verified is not yet being set). Staff still needs a verified email.
	const anyEmail = user.email?.toLowerCase();
	const email = user.emailVerified === false ? undefined : anyEmail;
	const mapped = anyEmail ? parseCustomerEmails(env.CUSTOMER_EMAILS).get(anyEmail) : undefined;
	return {
		sub: user.sub,
		...(user.email ? { email: user.email } : {}),
		...(user.name ? { name: user.name } : {}),
		...(customerById(mapped) ? { customerId: mapped } : {}),
		staff: email !== undefined && parseEmails(env.STAFF_EMAILS).has(email),
	};
}
