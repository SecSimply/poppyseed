import { decline } from "../../../../../lib/authenticator.ts";
import { authenticatorDeps } from "../../../../../lib/authenticator-deps.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	return decline(request, await authenticatorDeps(), (await params).id);
}
