import { poppyseed } from "../../../../poppyseed.config";
import { devices } from "../../../../lib/devices.ts";
import { viewerOf } from "../../../../lib/viewer.ts";

export const dynamic = "force-dynamic";

/** What the account page polls while it waits for the phone: whether the customer has a device, and its code while it waits. */
export async function GET(request: Request): Promise<Response> {
	const who = await viewerOf(await poppyseed.browserSession(request), request.headers.get("cookie"));
	const headers = { "cache-control": "no-store" };
	if (who.via !== "site") return Response.json({ error: "not signed in" }, { status: 401, headers });
	const device = await (await devices()).liveOf(who.customer.id);
	return Response.json(device ? { state: device.status, id: device.id, name: device.name, ...(device.status === "waiting" ? { code: device.code } : {}) } : { state: "none" }, { headers });
}
