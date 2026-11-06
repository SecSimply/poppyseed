import { sessionFrom } from "./session.ts";

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

/** The customer signed in to the site in this request's browser, from the session cookie. */
export function siteCustomer(cookieHeader: string | null): Customer | undefined {
	return customerById(sessionFrom(cookieHeader)?.customerId);
}
