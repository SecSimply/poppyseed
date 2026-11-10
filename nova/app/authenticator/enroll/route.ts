import { enroll } from "../../../lib/authenticator.ts";
import { authenticatorDeps } from "../../../lib/authenticator-deps.ts";

export const dynamic = "force-dynamic";

/** The Protea app claims an enrollment with the secret from the QR code on the website. */
export async function POST(request: Request): Promise<Response> {
	return enroll(request, await authenticatorDeps());
}
