import { poppyseed } from "../../../../poppyseed.config";
import { phoneSignin, PhoneSigninError } from "../../../../lib/phone-signin.ts";
import { viewerOf } from "../../../../lib/viewer.ts";

export const dynamic = "force-dynamic";

/** What the account page polls while it waits for the phone to use its code: pending, used or expired. Only for a code of the customer asking. */
export async function GET(request: Request): Promise<Response> {
	const headers = { "cache-control": "no-store" };
	const who = await viewerOf(await poppyseed.browserSession(request), request.headers.get("cookie"));
	if (who.via !== "site") return Response.json({ error: "not signed in" }, { status: 401, headers });
	const service = phoneSignin();
	const code = new URL(request.url).searchParams.get("e") ?? "";
	if (!service || !code) return Response.json({ error: "not found" }, { status: 404, headers });
	try {
		const state = await service.codeOf(who.customer.id, code);
		return state ? Response.json(state, { headers }) : Response.json({ error: "not found" }, { status: 404, headers });
	} catch (error) {
		if (!(error instanceof PhoneSigninError)) throw error;
		return Response.json({ error: "unavailable" }, { status: 502, headers });
	}
}
