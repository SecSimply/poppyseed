import { LOGIN_COOKIE, LOGIN_SECONDS, sealLogin, setCookie } from "../../../lib/session";
import { baseUrl } from "../../../lib/env";
import { oidc } from "../../../lib/oidc";
import { safeReturn } from "../../../lib/return-to";

export const dynamic = "force-dynamic";

/**
 * Starts a sign-in at Curity. `as=staff` asks for a fresh sign-in (prompt=login) so a shared browser is not signed in to
 * the support console by yesterday's customer login. The login's state is kept in a sealed cookie on this browser, so a
 * callback is only accepted from the browser that started it.
 */
export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const as = url.searchParams.get("as") === "staff" ? "staff" : "customer";
	const returnTo = safeReturn(url.searchParams.get("return_to") ?? "", baseUrl, as === "staff" ? "/staff" : "/account");
	if (!oidc) return Response.redirect(new URL(`/login?return_to=${encodeURIComponent(returnTo)}`, baseUrl), 303);
	const { url: provider, state } = await oidc.begin(as === "staff" ? { prompt: "login" } : {});
	return new Response(null, { status: 303, headers: { location: provider, "set-cookie": setCookie(LOGIN_COOKIE, sealLogin({ state, as, returnTo }), LOGIN_SECONDS), "cache-control": "no-store" } });
}
