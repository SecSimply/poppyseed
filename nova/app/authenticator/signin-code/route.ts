import { signinCode } from "../../../lib/authenticator.ts";
import { authenticatorDeps } from "../../../lib/authenticator-deps.ts";

export const dynamic = "force-dynamic";

/** The confirmed phone asks for the code that registers it for signing in. Signed by the phone. */
export async function POST(request: Request): Promise<Response> {
	return signinCode(request, await authenticatorDeps());
}
