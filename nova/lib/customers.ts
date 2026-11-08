import { secure } from "./env.ts";
import { links } from "./links.ts";
import { sessionFrom, type Session } from "./session.ts";

/**
 * Protea Bank's customers: two fictional people, with accounts. Who is signed in comes from the sealed session cookie
 * (see session.ts), set after a sign-in at Curity, or by the demonstration login on a local http site. A curity user
 * is one of these customers when CUSTOMER_EMAILS says so (see auth.ts).
 */
export interface Customer {
	id: string;
	name: string;
	email: string;
}

export const CUSTOMERS: Customer[] = [
	{ id: "cus_thandi", name: "Thandi Nkosi", email: "thandi@proteabank.example" },
	{ id: "cus_pieter", name: "Pieter van Wyk", email: "pieter@proteabank.example" },
];

export function customerById(id: string | undefined): Customer | undefined {
	return CUSTOMERS.find((c) => c.id === id);
}

/**
 * The customer a signed-in session is. A session that names its customer (the local demonstration login, the
 * conformance suite) is that customer. Any other is whoever the link table says its `sub` is, asked afresh each time.
 */
export async function customerOfSession(session: Session | undefined): Promise<Customer | undefined> {
	if (!session) return undefined;
	// Deployed over https, only the link table counts: the demonstration login and the test cookies exist only locally, and a cookie issued before links existed must not outlive an unlink.
	const named = secure && process.env.POPPYSEED_TEST_HOOKS !== "1" ? undefined : session.customerId;
	return customerById(named ?? (await (await links()).customerFor(session.sub)));
}

/** The customer signed in to the site in this request's browser, from the session cookie. */
export const siteCustomer = async (cookieHeader: string | null): Promise<Customer | undefined> => customerOfSession(sessionFrom(cookieHeader));
