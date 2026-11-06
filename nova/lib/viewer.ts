import { headers } from "next/headers";
import type { SessionContext } from "poppyseed";
import { poppyseed } from "../poppyseed.config";
import { customerById, type Customer } from "./customers";
import { sessionFrom } from "./session";

/** What the person or agent looking at a page may see. Reading balances and reading transactions are separate scopes. */
export type Viewer =
	| { via: "nobody" }
	/** Signed in to the site, but not as anyone with accounts: a Curity login that CUSTOMER_EMAILS does not map to a customer. */
	| { via: "visitor"; label: string }
	/** A customer signed in to the site in their own browser: they see everything of theirs. */
	| { via: "site"; customer: Customer }
	/** A personal agent's browser: it sees what its Session's scopes allow, the same as its tools, and nothing else. */
	| { via: "agent"; clientId: string; customer?: Customer; scopes: string[] };

/**
 * Pure part of `viewer()`. An agent's browser carries its Session's cookie, and while it does the page is that
 * Session's, signed in or not, whatever login cookie the browser also holds.
 */
export function viewerOf(session: SessionContext | null, cookieHeader: string | null): Viewer {
	if (session) return { via: "agent", clientId: session.clientId, customer: customerById(session.account?.id), scopes: session.account?.scopes ?? [] };
	const site = sessionFrom(cookieHeader);
	const customer = customerById(site?.customerId);
	if (customer) return { via: "site", customer };
	return site ? { via: "visitor", label: site.name ?? site.email ?? "this login" } : { via: "nobody" };
}

export async function viewer(): Promise<Viewer> {
	const cookie = (await headers()).get("cookie") ?? "";
	return viewerOf(await poppyseed.browserSession(new Request("http://internal/", { headers: { cookie } })), cookie);
}

/** Whether the viewer may see data that needs `scope`. A customer in their own browser may; an agent only with the scope. */
export function mayRead(v: Viewer, scope: string): boolean {
	return v.via === "site" || (v.via === "agent" && !!v.customer && v.scopes.includes(scope));
}

/** The customer whose pages these are, if any: the customer in their own browser, or the customer an agent's Session is signed in as. */
export const customerOf = (v: Viewer) => (v.via === "site" || v.via === "agent" ? v.customer : undefined);
