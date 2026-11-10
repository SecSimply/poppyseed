import { detail } from "../../../../lib/authenticator.ts";
import { authenticatorDeps } from "../../../../lib/authenticator-deps.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
	return detail(request, await authenticatorDeps(), (await params).id);
}
