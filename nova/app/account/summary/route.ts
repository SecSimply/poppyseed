import { poppyseed } from "../../../poppyseed.config";
import { accountsOf, balanceCents, zar } from "../../../lib/bank";
import { customerOf, mayRead, viewerOf } from "../../../lib/viewer";

export const dynamic = "force-dynamic";

/**
 * The customer's accounts and balances as plain text, for an agent that browses. It follows the Session in the browser
 * (spec 5): 200 for the customer in their own browser or an agent's Session with `accounts:read`, 401 for nobody, and
 * 403 naming the scope for a Session that lacks it, so the agent can ask for it.
 */
export async function GET(request: Request): Promise<Response> {
	const cookie = request.headers.get("cookie");
	const who = viewerOf(await poppyseed.browserSession(request), cookie);
	const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
	if (who.via === "nobody" || who.via === "visitor") return new Response("Sign in to Protea Bank to see your accounts.", { status: 401, headers });
	if (!mayRead(who, "accounts:read")) return new Response("This page needs the accounts:read scope. Ask the customer to approve a sign-in with it.", { status: 403, headers });
	const customer = customerOf(who)!;
	const lines = accountsOf(customer.id).map((a) => `${a.name} ••${a.endingDigits}: ${zar(balanceCents(a))}`);
	return new Response([`Accounts of ${customer.name}`, ...lines].join("\n"), { status: 200, headers });
}
