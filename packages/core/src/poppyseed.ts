import type { z } from "zod";
import { ClientRegistry } from "./clients.ts";
import { authorizeEndpoint, deviceVerificationEndpoint } from "./consent.ts";
import { Conversations, conversationsEndpoint, type ConversationsConfig } from "./conversations.ts";
import { authorizationServerMetadata, mcpResourceMetadata, poppyDocument } from "./discovery.ts";
import { PoppyError } from "./errors.ts";
import { guard, guardedFrom } from "./guard.ts";
import { mcpEndpoint } from "./mcp.ts";
import { mediatedEndpoint } from "./mediated.ts";
import { deviceAuthorizationEndpoint, revokeEndpoint, tokenEndpoint } from "./oauth.ts";
import { openApiDocument, toolCallEndpoint } from "./openapi.ts";
import { agentSupportsOperations, Operations, operationJson, operationsEndpoint, type OperationResult, type OperationView } from "./operations.ts";
import { PATHS, ROUTES } from "./paths.js";
import { withUsage } from "./ratelimit.ts";
import { key, revokeAccountToken, type Connection } from "./records.ts";
import { canSafeFetch, safeFetch } from "./safe-fetch.ts";
import { memoryStore } from "./store.ts";
import { Sealer } from "./tokens.ts";
import { Tools } from "./tools.ts";
import { checkExcludedTasks, excludedTasksDocument, feedbackEndpoint } from "./tasks.ts";
import { type OperationTool, type PoppyseedConfig, type ResolvedConfig, type RunTool, type SessionContext, type Terms, type ToolDefinition } from "./types.ts";
import { browserSessionEndpoint, browserSessionPage, readBrowserSession } from "./web.ts";
import { json } from "./util.ts";

/** Your staff's inbox for conversations handed off by Personal Agents (spec 7.9). */
export type StaffInbox = Pick<Conversations, "queue" | "get" | "join" | "reply" | "callTool" | "release" | "decline"> & {
	/** Closes a conversation, saying why, for example after inactivity. */
	close(conversationId: string, reason: string): Promise<void>;
};

export interface Poppyseed<C extends PoppyseedConfig = PoppyseedConfig> {
	/**
	 * Handles a Personal Agent Protocol request. Resolves to undefined when the
	 * path is not one of Poppyseed's, so the host framework can serve its own.
	 * Pass `pathname` when the host rewrote the URL.
	 */
	handle(request: Request, options?: { pathname?: string }): Promise<Response | undefined>;
	/** Public URLs of each part of the protocol, such as `urls.mcp`. */
	urls: ResolvedConfig["urls"];
	/** The tools you configured, as agents see them. */
	tools: Tools["list"];
	/** Wraps one of your own route handlers so it accepts only DPoP Session Tokens, optionally with a scope, and hands it the caller. */
	protect(handler: (request: Request, ctx: SessionContext) => Promise<Response> | Response, options?: { scope?: string }): (request: Request) => Promise<Response>;
	/** The Personal Agents connected to one of your accounts, for your account settings page. */
	connections: {
		list(accountId: string): Promise<Connection[]>;
		/** Disconnects a Personal Agent: revokes its Account Tokens and signs its Sessions out (spec 4.9). */
		disconnect(accountId: string, clientId: string): Promise<void>;
	};
	/** Ends a Session; its tokens stop working on the next request. */
	endSession(sessionId: string): Promise<void>;
	/**
	 * The Session a Personal Agent's browser carries on your website (spec 5),
	 * read fresh on every call, or null. Check it before your own session
	 * cookie: while the browser carries it, the request is that Session's.
	 */
	browserSession(request: Request): Promise<SessionContext | null>;
	/** Operations your tools proposed (operations extension). */
	operations: {
		/** An operation by ID. With `accountId`, only if it belongs to that account: use it for pages a customer sees. */
		get(operationId: string, accountId?: string): Promise<OperationView | undefined>;
		/** Confirms an operation from your website, for the browser's Session. It is the same operation, so it can't run twice. */
		confirm(operationId: string, session: SessionContext, revision: number): Promise<OperationView>;
		/**
		 * Approves an operation for the account holder signed in to your website, such as from the page its `url` names.
		 * Check who they are first; it throws operation_not_found unless the operation belongs to `accountId`.
		 */
		approve(operationId: string, accountId: string, revision: number): Promise<OperationView>;
		/** Records the outcome of an operation still in progress, for when `perform` couldn't tell whether it took effect. Final operations never change. */
		settle(operationId: string, state: "succeeded" | "failed" | "cancelled", result: OperationResult): Promise<void>;
	};
	/** Present when `conversations` is configured. */
	conversations: C["conversations"] extends ConversationsConfig ? StaffInbox : undefined;
}

type Handler = (request: Request, route: { publicUrl: string; params: Record<string, string> }) => Promise<Response>;

const notFound = () => new PoppyError(404, "not_found", "not found");
const cacheable = { "cache-control": "public, max-age=300" };

export function definePoppyseed<C extends PoppyseedConfig>(input: C): Poppyseed<C> {
	const config = resolveConfig(input);
	const sealer = new Sealer(config.secret);
	const clients = new ClientRegistry(config);
	const byName = new Map(Object.entries(config.tools));
	const operations = new Operations(config.store, byName);
	const tools = new Tools(byName, operations, clients);
	const conversations = config.conversations && new Conversations(config, config.conversations, tools);
	/** Signs out every Session an Account Token reached. Conversations and operations that used the account stay, for a sign-in (spec 4.9). */
	const signOut = async (hash: string) => {
		await revokeAccountToken(config.store, hash, { endSessions: config.sessions?.endOnSignOut === true });
	};
	const dpop = (request: Request, publicUrl: string) => guard(request, publicUrl, config, sealer, "dpop");
	const confirmWaitMs = config.operations?.confirmWait ?? 3000;

	/** One handler per method for every path in ROUTES; a path absent here is a bug the table check below catches. */
	const table: Record<string, Partial<Record<"GET" | "POST", Handler>>> = {
		[PATHS.poppyJson]: { GET: async () => json(poppyDocument(config, tools), 200, cacheable) },
		[PATHS.authorizationServer]: { GET: async () => json(authorizationServerMetadata(config, tools), 200, cacheable) },
		[PATHS.mcpResourceMetadata]: { GET: async () => json(mcpResourceMetadata(config), 200, cacheable) },
		[PATHS.token]: { POST: (request) => tokenEndpoint(request, config, clients, sealer) },
		[PATHS.revoke]: { POST: (request) => revokeEndpoint(request, config, clients, signOut) },
		[PATHS.authorize]: { GET: (request) => authorizeEndpoint(request, config, clients, sealer), POST: (request) => authorizeEndpoint(request, config, clients, sealer) },
		[PATHS.deviceAuthorization]: { POST: (request) => deviceAuthorizationEndpoint(request, config, clients) },
		[PATHS.deviceVerification]: { GET: (request) => deviceVerificationEndpoint(request, config, clients, sealer), POST: (request) => deviceVerificationEndpoint(request, config, clients, sealer) },
		[PATHS.mediated]: { POST: async (request, { publicUrl }) => mediatedEndpoint(request, config, clients, sealer, await dpop(request, publicUrl), undefined) },
		[`${PATHS.mediated}/:id`]: { POST: async (request, { publicUrl, params }) => mediatedEndpoint(request, config, clients, sealer, await dpop(request, publicUrl), params.id) },
		[PATHS.browserSession]: {
			GET: async () => (config.web ? browserSessionPage(config, sealer) : Promise.reject(notFound())),
			POST: async (request) => (config.web ? browserSessionEndpoint(request, config, sealer) : Promise.reject(notFound())),
		},
		[PATHS.mcp]: { POST: async (request, { publicUrl }) => mcpEndpoint(request, tools, config.organization.name, await guard(request, publicUrl, config, sealer, "mcp")) },
		[PATHS.feedback]: {
			POST: async (request, { publicUrl }) => {
				if (!config.feedback) throw notFound();
				return feedbackEndpoint(request, config, config.feedback, await dpop(request, publicUrl));
			},
		},
		[PATHS.excludedTasks]: { GET: async () => (config.excludedTasks ? excludedTasksDocument(config) : Promise.reject(notFound())) },
		[PATHS.openapi]: { GET: async () => json(openApiDocument(config, tools), 200, cacheable) },
		[`${PATHS.tools}/:name`]: { POST: async (request, { publicUrl, params }) => toolCallEndpoint(request, config.store, tools, await dpop(request, publicUrl), params.name!) },
		[`${PATHS.operations}/:id`]: { GET: async (request, { publicUrl, params }) => operationsEndpoint(request, operations, await dpop(request, publicUrl), params.id!, "read", confirmWaitMs) },
		[`${PATHS.operations}/:id/:action`]: {
			POST: async (request, { publicUrl, params }) => {
				if (params.action !== "confirm" && params.action !== "cancel") throw notFound();
				return operationsEndpoint(request, operations, await dpop(request, publicUrl), params.id!, params.action, confirmWaitMs, config.waitUntil);
			},
		},
		[PATHS.conversations]: {
			POST: async (request, { publicUrl }) => {
				if (!conversations) throw notFound();
				const auth = await dpop(request, publicUrl);
				return conversationsEndpoint(request, conversations, auth, { action: "start", supportsOperations: await agentSupportsOperations(clients, auth.ctx.clientId) });
			},
		},
		[`${PATHS.conversations}/:id/:action`]: Object.fromEntries(
			(["GET", "POST"] as const).map((method) => [
				method,
				async (request: Request, { publicUrl, params }: { publicUrl: string; params: Record<string, string> }) => {
					// Reads are GET; everything else is POST.
					const action = params.action;
					if (!conversations || (action !== "messages" && action !== "events" && action !== "handoff" && action !== "close") || (method === "GET") !== (action === "events")) throw notFound();
					return conversationsEndpoint(request, conversations, await dpop(request, publicUrl), { action, id: params.id! });
				},
			]),
		),
	};
	const routes = ROUTES.map((template) => {
		const methods = table[template];
		if (!methods) throw new Error(`poppyseed: no handler for ${template}`);
		const names = [...template.matchAll(/:(\w+)/g)].map((m) => m[1]!);
		const pattern = new RegExp(`^${template.replace(/[.]/g, "\\.").replace(/:\w+/g, "([A-Za-z0-9_-]{1,256})")}$`);
		return { pattern, names, methods };
	});

	const respond = async (request: Request, run: () => Promise<Response>): Promise<Response> => {
		try {
			return withUsage(request, await run());
		} catch (error) {
			if (error instanceof PoppyError) return withUsage(request, error.toResponse());
			console.error("[poppyseed]", error);
			return json({ error: "server_error", error_description: "internal error" }, 500, { "cache-control": "no-store" });
		}
	};
	// DPoP binds proofs to the public URL, so build it from baseUrl, not from the (possibly rewritten) request URL.
	const publicUrlOf = (pathname: string) => `${config.baseUrl}${pathname}`;

	return {
		async handle(request, options = {}) {
			const pathname = options.pathname ?? new URL(request.url).pathname;
			for (const { pattern, names, methods } of routes) {
				const match = pattern.exec(pathname);
				if (!match) continue;
				const handler = methods[request.method as "GET" | "POST"];
				if (!handler) return new Response(null, { status: 405, headers: { allow: Object.keys(methods).join(", ") } });
				const params = Object.fromEntries(names.map((name, i) => [name, match[i + 1]!]));
				return respond(request, () => handler(request, { publicUrl: publicUrlOf(pathname), params }));
			}
			return undefined;
		},
		urls: config.urls,
		tools: tools.list,
		protect: (handler, options = {}) => (request) =>
			respond(request, async () => {
				const auth = await dpop(request, publicUrlOf(new URL(request.url).pathname));
				auth.require(options.scope ?? null);
				return handler(request, auth.ctx);
			}),
		connections: {
			async list(accountId) {
				return ((await config.store.get<Connection[]>(key.connections(accountId))) ?? []).filter((c) => c.expiresAt > Date.now());
			},
			async disconnect(accountId, clientId) {
				const connections = (await config.store.get<Connection[]>(key.connections(accountId))) ?? [];
				for (const hash of connections.find((c) => c.clientId === clientId)?.tokens ?? []) {
					await signOut(hash);
				}
			},
		},
		endSession: (sessionId) => config.store.delete(key.session(sessionId)),
		browserSession: (request) => readBrowserSession(request, config, sealer),
		operations: {
			async get(operationId, accountId) {
				const op = await (accountId === undefined ? operations.read(operationId) : operations.ownedBy(operationId, accountId));
				return op && operationJson(op);
			},
			async confirm(operationId, session, revision) {
				const { op, settled } = await operations.confirm(operationId, guardedFrom(session), { revision, approved_by: "user" });
				config.waitUntil?.(settled);
				return operationJson(op);
			},
			async approve(operationId, accountId, revision) {
				const { op, settled } = await operations.approve(operationId, accountId, revision);
				config.waitUntil?.(settled);
				return operationJson(op);
			},
			async settle(operationId, state, result) {
				await operations.settle(operationId, state, result);
			},
		},
		conversations: (conversations && {
			queue: () => conversations.queue(),
			get: (id: string) => conversations.get(id),
			join: (id: string) => conversations.join(id),
			reply: (id: string, text: string, extra?: Parameters<Conversations["reply"]>[2]) => conversations.reply(id, text, extra),
			callTool: (id: string, name: string, input: unknown) => conversations.callTool(id, name, input),
			release: (id: string) => conversations.release(id),
			decline: (id: string, reason: string) => conversations.decline(id, reason),
			close: async (id: string, reason: string) => {
				await conversations.close(id, { reason });
			},
		}) as Poppyseed<C>["conversations"],
	};
}

function resolveConfig(input: PoppyseedConfig): ResolvedConfig {
	const url = new URL(input.baseUrl ?? `https://${input.organization.domain}`);
	if (url.pathname !== "/" || url.search) throw new Error("poppyseed: baseUrl is an origin, such as https://poppy.travel, with no path");
	const baseUrl = url.origin;
	const scopes = input.scopes ?? {};
	for (const name of Object.keys(scopes)) {
		if (name.startsWith("poppy:")) throw new Error(`poppyseed: scope ${name} must not start with poppy:, which the protocol reserves`);
	}
	const known = new Set<string>(Object.keys(scopes));
	for (const [name, tool] of Object.entries(input.tools ?? {})) {
		if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`poppyseed: tool name ${name} may use only letters, digits, - and _`);
		if (Boolean(tool.run) === Boolean(tool.operation)) throw new Error(`poppyseed: tool ${name} needs exactly one of run or operation`);
		if (tool.scope !== null && !known.has(tool.scope)) throw new Error(`poppyseed: tool ${name} needs unknown scope ${tool.scope}; add it to scopes`);
	}
	// Direct and Device Sign-In grant any of `scopes`; Mediated Sign-In only its own (spec 4.4).
	if (input.signIn && known.size === 0) throw new Error("poppyseed: signIn needs scopes, each with a description, for Personal Agents to request");
	// Each hint has both fields (spec 4.4); the types say so, JavaScript callers get the same check.
	for (const [name, hint] of Object.entries(input.scopeHints ?? {})) {
		if (!known.has(name)) throw new Error(`poppyseed: scopeHints names unknown scope ${name}`);
		if (!["none", "reversible", "irreversible"].includes(hint.changes) || typeof hint.personalData !== "boolean") {
			throw new Error(`poppyseed: scopeHints.${name} needs changes ("none", "reversible" or "irreversible") and personalData (true or false)`);
		}
	}
	const unknown = (input.signIn?.mediated?.scopes ?? []).filter((s) => !known.has(s));
	if (unknown.length > 0) throw new Error(`poppyseed: signIn.mediated offers unknown scopes ${unknown.join(", ")}`);
	if (input.excludedTasks) checkExcludedTasks(input.excludedTasks, Object.keys(input.tools ?? {}));
	// The types already require this; JavaScript callers get the same message.
	if (input.signIn && !input.accounts) throw new Error("poppyseed: signIn needs accounts, so the sign-in pages know who is signed in to your site");
	if (!input.store && globalThis.process?.env?.NODE_ENV === "production") {
		// Each serverless instance would keep its own sessions and replay cache.
		throw new Error("poppyseed: pass `store` in production. Use memoryStore() only when one long-lived process serves every request");
	}
	return {
		...input,
		baseUrl,
		scopes,
		apiDescription: input.apiDescription ?? `${input.organization.name} tools for personal agents`,
		store: input.store ?? memoryStore(),
		tools: input.tools ?? {},
		// On Node, metadata fetches check the address they connect to; in development, loopback agents are allowed.
		fetch: input.fetch ?? (canSafeFetch && !input.dev?.allowInsecureClients ? safeFetch : globalThis.fetch.bind(globalThis)),
		ttl: {
			token: input.sessions?.tokenTtl ?? 3600,
			session: input.sessions?.sessionTtl ?? 12 * 3600,
			accountToken: input.sessions?.accountTokenTtl ?? 90 * 86400,
		},
		urls: { issuer: baseUrl, ...(Object.fromEntries(Object.entries(PATHS).map(([name, path]) => [name, `${baseUrl}${path}`])) as Record<keyof typeof PATHS, string>) },
	};
}

/**
 * Declares a tool with typed input. With a scope, `ctx.account` is always
 * there; an operation's `perform` gets the terms `propose` returned.
 */
export function tool<Input extends z.ZodType, Scope extends string | null, Output>(definition: RunTool<Input, Scope, Output>): ToolDefinition;
export function tool<Input extends z.ZodType, Scope extends string | null, T extends Terms>(definition: OperationTool<Input, Scope, T>): ToolDefinition;
export function tool(definition: ToolDefinition): ToolDefinition {
	return definition;
}

