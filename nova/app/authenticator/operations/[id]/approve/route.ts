import { approve } from "../../../../../lib/authenticator.ts";
import { authenticatorDeps } from "../../../../../lib/authenticator-deps.ts";

export const dynamic = "force-dynamic";

/** The phone's approval: its request is signed, and so is the approval itself, with the key the fingerprint unlocks. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	return approve(request, await authenticatorDeps(), (await params).id);
}
