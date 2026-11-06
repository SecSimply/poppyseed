import { baseUrl } from "../../../lib/env";
import { clearCookie, SESSION_COOKIE } from "../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Signs out of Protea Bank: clears the session cookie. POST only, and only from this site's own pages, so another site
 * cannot sign a customer out. It does not sign the person out of Curity; closing the browser does that.
 */
export async function POST(request: Request): Promise<Response> {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(baseUrl).origin) return new Response("not allowed", { status: 403 });
	return new Response(null, { status: 303, headers: { location: new URL("/", baseUrl).toString(), "set-cookie": clearCookie(SESSION_COOKIE), "cache-control": "no-store" } });
}
