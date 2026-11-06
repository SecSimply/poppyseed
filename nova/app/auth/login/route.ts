import { LOGIN_COOKIE, LOGIN_SECONDS, sealLogin, setCookie } from "../../../lib/session";
import { baseUrl } from "../../../lib/env";
import { oidc } from "../../../lib/oidc";
import { safeReturn } from "../../../lib/return-to";

export const dynamic = "force-dynamic";

/**
 * Starts a sign-in at Curity. `as=staff` asks for a fresh sign-in (prompt=login) so a shared browser is not signed in to
 * the support console by yesterday's customer login. `fresh=1` asks for the same for a customer: Curity keeps its own
 * session after Protea Bank signs someone out, and reuses the details from that earlier sign-in, so a change made to the
 * person at Curity (such as marking an email verified) is only seen after a fresh one. The login's state is kept in a sealed cookie on this browser, so a
 * callback is only accepted from the browser that started it.
 */
export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const as = url.searchParams.get("as") === "staff" ? "staff" : "customer";
	const returnTo = safeReturn(url.searchParams.get("return_to") ?? "", baseUrl, as === "staff" ? "/staff" : "/account");
	if (!oidc) return Response.redirect(new URL(`/login?return_to=${encodeURIComponent(returnTo)}`, baseUrl), 303);
	const fresh = as === "staff" || url.searchParams.get("fresh") === "1";
	const { url: provider, state } = await oidc.begin(fresh ? { prompt: "login" } : {});
	return new Response(null, { status: 303, headers: { location: provider, "set-cookie": setCookie(LOGIN_COOKIE, sealLogin({ state, as, returnTo }), LOGIN_SECONDS), "cache-control": "no-store" } });
}
