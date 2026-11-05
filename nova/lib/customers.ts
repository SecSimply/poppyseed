/**
 * Nova Bank's own customers and sign-in. A demonstration: two fictional customers and a cookie naming who is
 * signed in. A real bank uses its existing authentication here; Poppyseed only asks "who is signed in to this
 * browser?" and "where do they sign in?".
 */
export interface Customer {
	id: string;
	name: string;
	email: string;
}

export const CUSTOMERS: Customer[] = [
	{ id: "cus_ada", name: "Ada Okoye", email: "ada@novabank.example" },
	{ id: "cus_ben", name: "Ben Marlow", email: "ben@novabank.example" },
];

export const SITE_COOKIE = "nb_session";

export function customerById(id: string | undefined): Customer | undefined {
	return CUSTOMERS.find((c) => c.id === id);
}

/** The customer signed in to the site in this request's browser, from the site's own cookie. */
export function siteCustomer(cookieHeader: string | null): Customer | undefined {
	const id = new RegExp(`(?:^|;\\s*)${SITE_COOKIE}=([\\w-]+)`).exec(cookieHeader ?? "")?.[1];
	return customerById(id);
}
