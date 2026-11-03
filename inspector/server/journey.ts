import type { TestAgent } from "poppyseed/agent";
import type { ProtocolEvent } from "../shared/events.ts";

interface Tool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface JourneyOptions {
	target: string;
	emit: (event: ProtocolEvent) => void;
	setStep: (id: string) => void;
	/** A tool anyone can call, and its arguments, for the "call a public tool" step. Skipped when the site has no such tool. */
	publicTool?: { name: string; arguments: Record<string, unknown> };
}

const errorText = (error: unknown) => {
	if (!(error instanceof Error)) return String(error);
	const body = (error as { body?: unknown }).body;
	return body ? `${error.message}\n${typeof body === "string" ? body : JSON.stringify(body)}` : error.message;
};

/**
 * Phase 1 of the journey: discover, start a Session, list tools over MCP, call a public tool.
 * Each step reports what it did; a failing step stops the run, since later steps depend on it.
 */
export async function runJourney(agent: TestAgent, { target, emit, setStep, publicTool }: JourneyOptions): Promise<boolean> {
	const step = async (id: string, title: string, body: () => Promise<string[] | "skipped">): Promise<boolean> => {
		setStep(id);
		emit({ type: "step.start", step: id, title, at: Date.now() });
		try {
			const result = await body();
			emit({ type: "step.end", step: id, ok: true, summary: result === "skipped" ? ["skipped"] : result, at: Date.now() });
			return true;
		} catch (error) {
			emit({ type: "step.end", step: id, ok: false, summary: [], error: errorText(error), at: Date.now() });
			return false;
		}
	};

	let session: Awaited<ReturnType<TestAgent["startSession"]>> | undefined;
	let mcp: { url: string; token: string } | undefined;
	let tools: Tool[] = [];

	const steps: [string, string, () => Promise<string[] | "skipped">][] = [
		[
			"discover",
			"Discover the company",
			async () => {
				const company = await agent.discover(target);
				return [
					`organization: ${company.poppy.organization.name} (${company.poppy.organization.domain})`,
					`protocol_version: ${company.poppy.protocol_version}`,
					`apis: ${(company.poppy.apis ?? []).map((a) => a.type).join(", ") || "none"}`,
					`extensions: ${Object.keys(company.poppy.extensions ?? {}).join(", ") || "none"}`,
					`scopes: ${Object.keys(company.poppy.auth?.scopes ?? {}).join(", ") || "none"}`,
				];
			},
		],
		[
			"session",
			"Start a Session",
			async () => {
				session = await agent.startSession();
				return [`token_type: ${session.token_type}`, `expires_in: ${session.expires_in}s`, `signed in: no`, `session key (jkt): ${session.session.jkt}`];
			},
		],
		[
			"tools",
			"List tools over MCP",
			async () => {
				if (!session) throw new Error("no Session");
				const url = agent.endpoint("mcp");
				const bound = await agent.startSession({ session: session.session, resource: url });
				mcp = { url, token: bound.access_token };
				const listed = await agent.mcp<{ tools?: Tool[] }>(url, bound.access_token, "tools/list");
				tools = listed.tools ?? [];
				return [`${tools.length} tools`, ...tools.map((t) => `${t.name}${t.description ? `: ${t.description}` : ""}`)];
			},
		],
		[
			"call",
			"Call a public tool",
			async () => {
				if (!mcp) throw new Error("no MCP token");
				const wanted = publicTool && tools.find((t) => t.name === publicTool.name);
				if (!publicTool || !wanted) return "skipped";
				const result = await agent.mcp<{ isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] }>(mcp.url, mcp.token, "tools/call", { name: publicTool.name, arguments: publicTool.arguments });
				if (result.isError) throw new Error(`${publicTool.name} returned an error: ${JSON.stringify(result.content)}`);
				return [`${publicTool.name}(${JSON.stringify(publicTool.arguments)})`, JSON.stringify(result.structuredContent ?? result.content ?? result).slice(0, 300)];
			},
		],
	];

	for (const [id, title, body] of steps) if (!(await step(id, title, body))) return false;
	return true;
}
