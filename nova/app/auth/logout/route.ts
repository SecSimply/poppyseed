import { baseUrl } from "../../../lib/env";
import { oidc } from "../../../lib/oidc";
import { clearCookie, SESSION_COOKIE } from "../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Signs out of Protea Bank: clears the session cookie. POST only, and only from this site's own pages, so another site
 * cannot sign a customer out. Then it sends the browser to Curity's
 * logout endpoint, so the Curity session ends too and the next sign-in asks for a password; if Curity can't be reached
 * or has no such endpoint, the person is still signed out of Protea Bank.
 */
export async function POST(request: Request): Promise<Response> {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(baseUrl).origin) return new Response("not allowed", { status: 403 });
	const home = new URL("/", baseUrl).toString();
	let location = home;
	try {
		location = (await oidc?.logoutUrl(home)) ?? home;
	} catch (error) {
		console.error("sign-out: could not reach Curity's logout:", error instanceof Error ? error.message : error);
	}
	return new Response(null, { status: 303, headers: { location, "set-cookie": clearCookie(SESSION_COOKIE), "cache-control": "no-store" } });
}
