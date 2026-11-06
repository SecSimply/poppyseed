import { PATHS } from "poppyseed/paths";
import { Browser, PapError, readBody, type Discovery, type Fetch, type Operation, type TestAgent, type TokenResponse } from "poppyseed/agent";
import type { ProtocolEvent } from "../shared/events.ts";
import { approveOperation } from "./approval.ts";
import { browse } from "./browse.ts";
import { askForPerson, askSupport } from "./chat.ts";

interface Tool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

type Call = { name: string; arguments: Record<string, unknown> };

export interface JourneyOptions {
	target: string;
	emit: (event: ProtocolEvent) => void;
	setStep: (id: string) => void;
	/** A tool anyone can call, for the "call a public tool" step. Skipped when the site has no such tool. */
	publicTool?: Call;
	/** What to say to the company's agent. Without it, or when the company has none, the chat steps are skipped. */
	chat?: { hello: string; account: string };
	/** The fetch the agent uses, so the browser the browse step opens is seen like everything else. */
	fetch?: Fetch;
	/** Pages the agent's browser loads once it has joined its Session. Without a company website to join, the step is skipped. */
	browse?: string[];
	/** Set to run the sign-in and operation steps: they need a person to approve in their own browser. */
	signIn?: {
		/** Space-separated scopes to ask for. Defaults to every scope the site offers. */
		scopes?: string;
		/** A tool that needs the signed-in account. */
		scopedTool: Call;
		/** An action tool that proposes an operation, with its arguments. */
		operation: { name: string; arguments?: Record<string, unknown> };
		/** The person has pre-approved operations the company doesn't require their own approval for. */
		standingPermission?: boolean;
	};
	/** Resolves when the person decides in the inspector. Declines when the run is cancelled or times out. */
	decide: () => Promise<"approve" | "decline">;
	signal: AbortSignal;
	/** Called once discovery has found the company, so requests can be checked against its issuer. */
	onDiscovered?: (company: Discovery) => void;
}

const errorText = (error: unknown) => {
	if (!(error instanceof Error)) return String(error);
	const body = (error as { body?: unknown }).body;
	return body ? `${error.message}\n${typeof body === "string" ? body : JSON.stringify(body)}` : error.message;
};

/** Runs one step: announces it, reports what it did, and says whether it passed. A thrown error fails the step. */
export const makeStep =
	(emit: (event: ProtocolEvent) => void, setStep: (id: string) => void) =>
	async (id: string, title: string, body: () => Promise<string[] | "skipped">): Promise<boolean> => {
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

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal.aborted) return reject(new Error("run cancelled"));
		const timer = setTimeout(() => (signal.removeEventListener("abort", onAbort), resolve()), ms);
		const onAbort = () => (clearTimeout(timer), reject(new Error("run cancelled")));
		signal.addEventListener("abort", onAbort, { once: true });
	});

/**
 * The journey: discover, start a Session, list tools over MCP, call a public tool; then, when asked, sign a person
 * in (Device Sign-In), call a scoped tool, propose an operation, wait for the person's decision, and sign out.
 * Each step reports what it did; a failing step stops the run, since later steps depend on it.
 */
export async function runJourney(agent: TestAgent, options: JourneyOptions): Promise<boolean> {
	const { target, emit, setStep, publicTool, chat, signIn, decide, signal } = options;
	const siteFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	const step = makeStep(emit, setStep);
	const need = <T>(value: T | undefined, what: string): T => {
		if (value === undefined) throw new Error(`no ${what}`);
		return value;
	};

	let company: Discovery | undefined;
	let session: TokenResponse | undefined;
	let mcp: { url: string; token: string } | undefined;
	let tools: Tool[] = [];
	let signedIn: TokenResponse | undefined;
	let operation: Operation | undefined;
	let conversationId: string | undefined;
	let excluded: { task: string }[] = [];
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
				options.onDiscovered?.(company);
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
			"excluded",
			"Read the tasks it won't offer",
			async () => {
				// Spec 8.1: read before starting on a task. No token is needed, and the document is the same for everyone.
				if (!agent.endpoints.excludedTasks) return "skipped";
				const { tasks } = await agent.excludedTasks();
				excluded = tasks;
				if (!tasks.length) return ["the company lists no excluded tasks"];
				return [
					`${tasks.length} task${tasks.length === 1 ? "" : "s"} the company does not offer an agent`,
					...tasks.map((t) => `• ${t.task}${t.alternative?.instructions ? ` — ${t.alternative.instructions.slice(0, 160)}${t.alternative.instructions.length > 160 ? "…" : ""}` : " (no alternative given)"}`),
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
				const result = await agent.mcp<{ isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] }>(m.url, m.token, "tools/call", { name: publicTool.name, arguments: publicTool.arguments });
				if (result.isError) throw new Error(`${publicTool.name} returned an error: ${JSON.stringify(result.content)}`);
				return [`${publicTool.name}(${JSON.stringify(publicTool.arguments)})`, JSON.stringify(result.structuredContent ?? result.content ?? result).slice(0, 300)];
			},
		],
		[
			"chat",
			"Ask the company's agent",
			async () => {
				if (!chat || !agent.endpoints.conversations) return "skipped";
				const talk = await askSupport(agent, need(session, "Session").access_token, chat.hello);
				return [...talk.lines, `conversation ${talk.conversationId}: ${talk.status}, handled by ${talk.responder}`];
			},
		],
		[
			"chat-excluded",
			"Ask it for a task it won't offer",
			async () => {
				// The company's agent must not offer a listed task either (spec 8.1): it should decline and say where to do it.
				if (!chat || !agent.endpoints.conversations || !excluded.length) return "skipped";
				const talk = await askSupport(agent, need(session, "Session").access_token, excluded[0]!.task);
				return [...talk.lines, `conversation ${talk.conversationId}: ${talk.status}, handled by ${talk.responder}`];
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
					const scope = signIn.scopes ?? supported.join(" ");
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
				"browse",
				"Browse the site as the agent",
				async () => {
					if (!agent.endpoints.browserSession || !options.browse) return "skipped";
					const key = need(signedIn?.session, "Session Key");
					const browser = new Browser(siteFetch);
					const lines = await browse({ target, join: () => agent.joinBrowser(browser, key), get: (url) => browser.request(url) }, options.browse);
					return [`signed in with: ${signedIn?.scope ?? "no scope"}`, ...lines];
				},
			],
			[
				"chat-account",
				"Ask the company's agent about your account",
				async () => {
					if (!chat || !agent.endpoints.conversations) return "skipped";
					const talk = await askSupport(agent, need(signedIn, "signed-in Session").access_token, chat.account);
					conversationId = talk.conversationId;
					return [...talk.lines, `conversation ${talk.conversationId}: ${talk.status}, handled by ${talk.responder}`];
				},
			],
			[
				"handoff",
				"Ask for a person",
				async () => (conversationId ? askForPerson(agent, need(signedIn, "signed-in Session").access_token, conversationId) : "skipped"),
			],
			[
				"propose",
				"Propose an operation",
				async () => {
					if (!hasTool(signIn.operation.name)) return "skipped";
					const args = signIn.operation.arguments;
					if (!args) throw new Error(`no arguments for ${signIn.operation.name}: set OPERATION_ARGS`);
					const body = await callTool(signIn.operation.name, args);
					operation = body.operation as Operation | undefined;
					if (!operation) throw new Error(`${signIn.operation.name} did not propose an operation: ${JSON.stringify(body)}`);
					return [
						`${signIn.operation.name}(${JSON.stringify(args)})`,
						`operation ${operation.operation_id} · revision ${operation.revision} · ${operation.state}`,
						operation.summary,
						...(operation.user_approval_required ? ["the company requires the person's own approval for this one"] : []),
					];
				},
			],
			[
				"approve",
				"The person decides",
				async () => {
					if (!operation) return "skipped";
					const token = need(signedIn, "signed-in Session").access_token;
					const settled = await approveOperation(agent, token, operation, { emit, decide, standingPermission: signIn.standingPermission === true, sleep: (ms) => sleep(ms, signal) });
					operation = settled.operation;
					return settled.summary;
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
