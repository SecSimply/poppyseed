import { list } from "../../../lib/authenticator.ts";
import { authenticatorDeps } from "../../../lib/authenticator-deps.ts";

export const dynamic = "force-dynamic";

/** What is waiting for the phone's customer. Signed by the phone. */
export async function GET(request: Request): Promise<Response> {
	return list(request, await authenticatorDeps());
}
