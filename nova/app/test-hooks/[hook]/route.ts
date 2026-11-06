import { hooks, profile } from "../../../lib/conformance";

/**
 * Company-side powers for `poppyseed check --hooks`, only when POPPYSEED_TEST_HOOKS=1. GET /test-hooks/hooks lists them
 * with the profile; POST /test-hooks/<hook> with {"args": [...]} runs one. They sign test people in and end Sessions:
 * never enable this on a site with real customers.
 */
type Context = { params: Promise<{ hook: string }> };

const enabled = () => process.env.POPPYSEED_TEST_HOOKS === "1";

export async function GET(_request: Request, context: Context): Promise<Response> {
	if (!enabled() || (await context.params).hook !== "hooks") return new Response("not found", { status: 404 });
	return Response.json({ hooks: Object.keys(hooks), profile });
}

export async function POST(request: Request, context: Context): Promise<Response> {
	const { hook } = await context.params;
	if (!enabled() || !Object.hasOwn(hooks, hook)) return new Response("not found", { status: 404 });
	const { args = [] } = (await request.json()) as { args?: unknown[] };
	// JSON arguments from the suite, passed through as they came.
	const call = hooks[hook as keyof typeof hooks] as (...args: unknown[]) => Promise<unknown>;
	return Response.json({ result: (await call(...args)) ?? null });
}
