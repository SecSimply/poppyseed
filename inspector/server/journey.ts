import { PATHS } from "poppyseed/paths";
import { PapError, readBody, type Discovery, type Operation, type TestAgent, type TokenResponse } from "poppyseed/agent";
import type { ProtocolEvent } from "../shared/events.ts";

interface Tool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

type Offer = { offer_id: string; price?: { amount: string } };
type Call = { name: string; arguments: Record<string, unknown> };

export interface JourneyOptions {
	target: string;
	emit: (event: ProtocolEvent) => void;
	setStep: (id: string) => void;
	/** A tool anyone can call, for the "call a public tool" step. Skipped when the site has no such tool. */
	publicTool?: Call;
	/** Set to run the sign-in and operation steps: they need a person to approve in their own browser. */
	signIn?: {
		/** Space-separated scopes to ask for. Defaults to the demo's, or every scope the site offers. */
		scopes?: string;
		/** A tool that needs the signed-in account. */
		scopedTool: Call;
		/** An action tool that proposes an operation. Arguments default from the public tool's first offer when it is book_flight. */
		operation: { name: string; arguments?: Record<string, unknown> };
	};
	/** Resolves when the person decides in the inspector. Declines when the run is cancelled or times out. */
	decide: () => Promise<"approve" | "decline">;
	signal: AbortSignal;
}

const errorText = (error: unknown) => {
	if (!(error instanceof Error)) return String(error);
	const body = (error as { body?: unknown }).body;
	return body ? `${error.message}\n${typeof body === "string" ? body : JSON.stringify(body)}` : error.message;
};

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal.aborted) return reject(new Error("run cancelled"));
		const timer = setTimeout(() => (signal.removeEventListener("abort", onAbort), resolve()), ms);
		const onAbort = () => (clearTimeout(timer), reject(new Error("run cancelled")));
		signal.addEventListener("abort", onAbort, { once: true });
	});

const DEMO_SCOPES = ["trips:read", "trips:write"];
const TERMINAL: Operation["state"][] = ["succeeded", "failed", "cancelled", "expired"];

/**
 * The journey: discover, start a Session, list tools over MCP, call a public tool; then, when asked, sign a person
 * in (Device Sign-In), call a scoped tool, propose an operation, wait for the person's decision, and sign out.
 * Each step reports what it did; a failing step stops the run, since later steps depend on it.
 */
export async function runJourney(agent: TestAgent, options: JourneyOptions): Promise<boolean> {
	const { target, emit, setStep, publicTool, signIn, decide, signal } = options;
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
	const need = <T>(value: T | undefined, what: string): T => {
		if (value === undefined) throw new Error(`no ${what}`);
		return value;
	};

	let company: Discovery | undefined;
	let session: TokenResponse | undefined;
	let mcp: { url: string; token: string } | undefined;
	let tools: Tool[] = [];
	let offers: Offer[] = [];
	let signedIn: TokenResponse | undefined;
	let operation: Operation | undefined;
	const hasTool = (name: string) => tools.some((t) => t.name === name);

	/** A signed-in call to one of the site's tools over its HTTP API. */
	const callTool = async (name: string, args: unknown) => {
		const token = need(signedIn, "signed-in Session").access_token;
		const response = await agent.dpopJson(new URL(`${PATHS.tools}/${name}`, target).toString(), token, args);
		const body = (await readBody(response)) as Record<string, unknown>;
		if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(body)}`);
		return body;
	};

	const steps: [string, string, () => Promise<string[] | "skipped">][] = [
		[
			"discover",
			"Discover the company",
			async () => {
				company = await agent.discover(target);
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
				const bound = await agent.startSession({ session: need(session, "Session").session, resource: agent.endpoint("mcp") });
				mcp = { url: agent.endpoint("mcp"), token: bound.access_token };
				const listed = await agent.mcp<{ tools?: Tool[] }>(mcp.url, bound.access_token, "tools/list");
				tools = listed.tools ?? [];
				return [`${tools.length} tools`, ...tools.map((t) => `${t.name}${t.description ? `: ${t.description}` : ""}`)];
			},
		],
		[
			"call",
			"Call a public tool",
			async () => {
				const m = need(mcp, "MCP token");
				if (!publicTool || !hasTool(publicTool.name)) return "skipped";
				const result = await agent.mcp<{ isError?: boolean; structuredContent?: { offers?: Offer[] }; content?: { text?: string }[] }>(m.url, m.token, "tools/call", { name: publicTool.name, arguments: publicTool.arguments });
				if (result.isError) throw new Error(`${publicTool.name} returned an error: ${JSON.stringify(result.content)}`);
				offers = result.structuredContent?.offers ?? [];
				return [`${publicTool.name}(${JSON.stringify(publicTool.arguments)})`, JSON.stringify(result.structuredContent ?? result.content ?? result).slice(0, 300)];
			},
		],
	];

	if (signIn) {
		steps.push(
			[
				"signin",
				"Sign a person in (Device Sign-In)",
				async () => {
					const c = need(company, "discovery");
					if (!c.metadata.device_authorization_endpoint) throw new Error("the company does not offer Device Sign-In");
					const supported = c.metadata.scopes_supported ?? [];
					const demo = DEMO_SCOPES.filter((s) => supported.includes(s));
					const scope = signIn.scopes ?? (demo.length ? demo : supported).join(" ");
					const device = await agent.deviceAuthorization(scope);
					// Spec 4.6: show a link only if it is on the company's own domain, so a hostile response can't send the person elsewhere.
					const shown = [device.verification_uri_complete, device.verification_uri].find((u) => u && agent.mayShowVerificationUri(u));
					if (!shown) throw new Error(`refusing to show ${device.verification_uri}: its host is not the issuer's or a protected resource's (spec 4.6)`);
					emit({
						type: "action.required",
						step: "signin",
						kind: "device-signin",
						title: `Approve the sign-in at ${c.poppy.organization.name}`,
						lines: [`Open the link, sign in to ${c.poppy.organization.domain} if asked, and check that the code matches.`, `Scopes requested: ${scope}`],
						link: shown,
						code: device.user_code,
						expiresAt: Date.now() + device.expires_in * 1000,
						at: Date.now(),
					});
					let interval = Math.max(device.interval, 1) * 1000;
					const deadline = Date.now() + device.expires_in * 1000;
					for (;;) {
						await sleep(interval, signal);
						if (Date.now() > deadline) throw new Error("the code expired before it was approved");
						try {
							signedIn = await agent.pollDevice(device.device_code, need(session, "Session").session);
							break;
						} catch (error) {
							if (error instanceof PapError && error.error === "authorization_pending") continue;
							if (error instanceof PapError && error.error === "slow_down") {
								interval += 5000;
								continue;
							}
							if (error instanceof PapError && error.error === "access_denied") throw new Error("the person declined the sign-in");
							throw error;
						}
					}
					emit({ type: "action.resolved", step: "signin", outcome: "approved", at: Date.now() });
					return [`signed in`, `scope: ${signedIn.scope ?? scope}`, `Account Token issued: ${signedIn.refresh_token ? "yes (hidden)" : "no"}`];
				},
			],
			[
				"account",
				"Call a scoped tool",
				async () => {
					if (!hasTool(signIn.scopedTool.name)) return "skipped";
					const body = await callTool(signIn.scopedTool.name, signIn.scopedTool.arguments);
					return [`${signIn.scopedTool.name}(${JSON.stringify(signIn.scopedTool.arguments)})`, JSON.stringify(body).slice(0, 300)];
				},
			],
			[
				"propose",
				"Propose an operation",
				async () => {
					if (!hasTool(signIn.operation.name)) return "skipped";
					const args =
						signIn.operation.arguments ??
						(signIn.operation.name === "book_flight" && offers.length
							? { offer_id: (offers.find((o) => Number(o.price?.amount ?? Infinity) <= 1000) ?? offers[0])!.offer_id, traveler_name: "Inspector Test" }
							: undefined);
					if (!args) throw new Error(`no arguments for ${signIn.operation.name}: set OPERATION_ARGS`);
					const body = await callTool(signIn.operation.name, args);
					operation = body.operation as Operation | undefined;
					if (!operation) throw new Error(`${signIn.operation.name} did not propose an operation: ${JSON.stringify(body)}`);
					return [
						`${signIn.operation.name}(${JSON.stringify(args)})`,
						`operation ${operation.operation_id} · revision ${operation.revision} · ${operation.state}`,
						operation.summary,
						...(operation.user_approval_required ? ["this one needs the person's own approval on the company's page"] : []),
					];
				},
			],
			[
				"approve",
				"The person decides",
				async () => {
					if (!operation) return "skipped";
					const token = need(signedIn, "signed-in Session").access_token;
					const op = operation;
					// The person approves what the summary says. The agent never confirms before they have.
					if (op.user_approval_required) {
						const link = op.url && agent.mayShowVerificationUri(op.url) ? op.url : undefined;
						emit({
							type: "action.required",
							step: "approve",
							kind: "open-link",
							title: "Approve on the company's page",
							lines: [op.summary, link ? "Open the link and approve there." : "The company gave no approval link on its own domain."],
							...(link ? { link } : {}),
							at: Date.now(),
						});
						const deadline = Date.now() + 10 * 60_000;
						for (;;) {
							await sleep(3000, signal);
							const current = (await agent.operation(token, op.operation_id)).operation;
							if (current.state !== "proposed") {
								operation = current;
								break;
							}
							if (Date.now() > deadline) throw new Error("no approval within 10 minutes");
						}
						emit({ type: "action.resolved", step: "approve", outcome: operation.state, at: Date.now() });
						return [`state: ${operation.state}`, operation.result?.summary ?? ""].filter(Boolean);
					}
					emit({
						type: "action.required",
						step: "approve",
						kind: "approve-operation",
						title: "Approve or decline this operation",
						lines: [op.summary, `terms: ${JSON.stringify(op.terms ?? {})}`, ...(op.expires_at ? [`expires: ${op.expires_at}`] : [])],
						at: Date.now(),
					});
					const decision = await decide();
					if (decision === "decline") {
						operation = await agent.cancel(token, op.operation_id);
						emit({ type: "action.resolved", step: "approve", outcome: "declined", at: Date.now() });
						return ["declined: the operation was cancelled", `state: ${operation.state}`];
					}
					let reply = await agent.confirm(token, op);
					for (let i = 0; i < 10 && !TERMINAL.includes(reply.operation.state); i++) {
						await sleep(Math.max(1000, Number(reply.retryAfter) * 1000 || 1000), signal);
						reply = await agent.operation(token, op.operation_id);
					}
					operation = reply.operation;
					emit({ type: "action.resolved", step: "approve", outcome: "approved", at: Date.now() });
					return [`state: ${operation.state}`, operation.result?.summary ?? "", `approved_by: ${operation.confirmation?.approved_by ?? "?"}`].filter(Boolean);
				},
			],
		);
	}

	let ok = true;
	for (const [id, title, body] of steps) {
		if (signal.aborted || !(await step(id, title, body))) {
			ok = false;
			break;
		}
	}

	// Don't leave a standing credential at the company (spec 4.9), whether or not the journey finished.
	if (signedIn?.refresh_token) {
		const account = signedIn.refresh_token;
		await step("signout", "Sign out (revoke the Account Token)", async () => {
			await agent.revoke(account);
			return ["Account Token revoked"];
		});
	}
	return ok && !signal.aborted;
}
