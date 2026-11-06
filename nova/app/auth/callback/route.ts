import { sessionFor } from "../../../lib/auth";
import { baseUrl } from "../../../lib/env";
import { oidc } from "../../../lib/oidc";
import { clearCookie, cookieValue, LOGIN_COOKIE, openLogin, sessionCookie } from "../../../lib/session";

export const dynamic = "force-dynamic";

const page = (status: number, message: string) =>
	new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in</title><body style="font:17px/1.6 system-ui;max-width:34rem;margin:15vh auto;padding:0 1rem"><h1>Sign-in</h1><p>${message}</p><p><a href="/">Back to Protea Bank</a></p>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/** Finishes a sign-in: checks that this browser started it, exchanges the code, and sets the session cookie. No token is kept. */
export async function GET(request: Request): Promise<Response> {
	if (!oidc) return page(404, "Sign in with Curity is not configured.");
	const login = openLogin(cookieValue(request.headers.get("cookie"), LOGIN_COOKIE));
	try {
		const user = await oidc.finish(new URL(request.url).searchParams, login?.state);
		const session = sessionFor(user);
		// What happened, without who: enough to see why a login found no accounts or no staff access.
		console.log(`sign-in: email=${user.email ? "sent" : "not sent"} verified=${user.emailVerified ?? "not sent"} name=${user.name ? "sent" : "not sent"} customer=${session.customerId ? "linked" : "none"} staff=${session.staff}`);
		const headers = new Headers({ location: new URL(login!.returnTo, baseUrl).toString(), "cache-control": "no-store" });
		headers.append("set-cookie", sessionCookie(session));
		headers.append("set-cookie", clearCookie(LOGIN_COOKIE));
		return new Response(null, { status: 303, headers });
	} catch (error) {
		// By name: this route and the library may be bundled separately, so `instanceof` is not reliable here.
		if (error instanceof Error && error.name === "BadCallback") return page(400, "The sign-in could not be completed. Please start again.");
		console.error("sign-in failed:", error instanceof Error ? error.message : error);
		return page(502, "Curity could not be reached, or refused the sign-in. Please try again in a moment.");
	}
}
