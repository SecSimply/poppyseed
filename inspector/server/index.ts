/**
 * Poppy Inspector backend. Runs one real Personal Agent (poppyseed/agent) against TARGET_URL, reports every
 * request it makes as a stream of events, and serves the built UI.
 *
 * The agent's identity is hosted here: /agent/client.json and /agent/jwks.json, on this server's own HTTPS origin,
 * so the target fetches them like any agent's. Nothing needs loosening on the target.
 *
 * Who may use it: people who sign in with Curity (OIDC, authorization code + PKCE) and are on the allow-list, or
 * a script holding INSPECTOR_TOKEN. Production requires at least one of the two.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { TestAgent } from "poppyseed/agent";
import type { AuthInfo, InspectorConfig, ProtocolEvent } from "../shared/events.ts";
import { capture, type Knowledge } from "./capture.ts";
import { FAULTS, faultInfo, runFault } from "./faults.ts";
import { runJourney } from "./journey.ts";
import { parseOperations, type OperationPreset } from "./presets.ts";
import { parsePaths } from "./browse.ts";
import { BadCallback, NotAllowed, Oidc, oidcFromEnv } from "./oidc.ts";

const port = Number(process.env.PORT ?? 3001);
const publicUrl = (process.env.INSPECTOR_PUBLIC_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)).replace(/\/$/, "");
const secure = publicUrl.startsWith("https://");
// Anything that looks deployed is production, so forgetting NODE_ENV can't leave the API open.
const production = process.env.NODE_ENV === "production" || secure || Boolean(process.env.RAILWAY_ENVIRONMENT);
const target = (process.env.TARGET_URL ?? (production ? "" : "http://localhost:3000")).replace(/\/$/, "");
if (!target) throw new Error("Set TARGET_URL to the Poppyseed site to inspect");
const token = process.env.INSPECTOR_TOKEN ?? "";
const oidcConfig = oidcFromEnv(process.env, publicUrl);
const oidc = oidcConfig && new Oidc(oidcConfig);
if (production && !oidc && token.length < 16) throw new Error("Set OIDC_* (sign in with Curity) or INSPECTOR_TOKEN (16+ characters) in production: this server holds a live agent identity");
const redact = process.env.INSPECTOR_REVEAL !== "1";
const clientId = `${publicUrl}/agent/client.json`;

/** Tools for the journey's steps. The defaults are the Poppy Travel demo's; a step is skipped when the target has no such tool. */
const json_env = (name: string): Record<string, unknown> | undefined => (process.env[name] ? (JSON.parse(process.env[name]!) as Record<string, unknown>) : undefined);
const publicTool = {
	name: process.env.PUBLIC_TOOL ?? "search_flights",
	arguments: json_env("PUBLIC_TOOL_ARGS") ?? { from: "SFO", to: "LIS", date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) },
};
const operations = parseOperations(process.env);
const signInOptions = (operation: OperationPreset) => ({
	scopes: process.env.SIGNIN_SCOPES,
	scopedTool: { name: process.env.SCOPED_TOOL ?? "my_trips", arguments: json_env("SCOPED_TOOL_ARGS") ?? {} },
	operation: { name: operation.name, arguments: operation.arguments },
	// A demonstration of the difference between an operation the company lets an agent do and one it keeps for the person.
	standingPermission: process.env.STANDING_PERMISSION === "1",
});

/** What the chat steps say to the company's agent. They are skipped when the target has no conversations. */
/** Pages the agent's browser loads in the browse step (BROWSE_PATHS, space-separated), after joining its Session. */
const browsePaths = parsePaths(process.env.BROWSE_PATHS);

const chat = { hello: process.env.CHAT_QUESTION ?? "What can you help me with?", account: process.env.CHAT_ACCOUNT_QUESTION ?? "What are my balances?" };

/** A 1x1 transparent PNG. */
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

interface Run {
	id: string;
	events: ProtocolEvent[];
	done: boolean;
	listeners: Set<(event: ProtocolEvent) => void>;
	abort: AbortController;
	/** Set while the run waits for the person to decide in the inspector. */
	decision?: (decision: "approve" | "decline") => void;
}
const runs = new Map<string, Run>();
let active: { run: Run; step: string } | undefined;

const emit = (run: Run) => (event: ProtocolEvent) => {
	run.events.push(event);
	for (const listener of run.listeners) listener(event);
};

/** What the current run has found out, for the JWT checks. Reset when a run starts. */
const knowledge: Knowledge = {};

/** Every request the agent, and the browser it opens, makes goes through here, so the run shows all of them. */
const seen = capture(
	globalThis.fetch.bind(globalThis),
	(event) => active && emit(active.run)(event),
	() => active?.step ?? "",
	redact,
	knowledge,
);

const agent = await TestAgent.create({
	clientId,
	clientName: "Poppy Inspector",
	allowInsecure: target.startsWith("http://"),
	extensions: { operations: { version: "1" } },
	fetch: seen,
});

function startRun(signIn: boolean, faultId?: string, operation: OperationPreset = operations[0]!): Run {
	const run: Run = { id: randomUUID(), events: [], done: false, listeners: new Set(), abort: new AbortController() };
	runs.set(run.id, run);
	for (const id of [...runs.keys()].slice(0, Math.max(0, runs.size - 20))) runs.delete(id); // keep the last 20
	active = { run, step: "" };
	const send = emit(run);
	delete knowledge.issuer;
	send({ type: "run.start", runId: run.id, target, clientId, redacted: redact, signIn, ...(faultId ? { fault: faultId } : {}), at: Date.now() });
	const decide = () =>
		new Promise<"approve" | "decline">((resolve) => {
			const finish = (d: "approve" | "decline") => (clearTimeout(timer), (run.decision = undefined), resolve(d));
			const timer = setTimeout(() => finish("decline"), 10 * 60_000); // nobody answered: decline, never approve by default
			run.abort.signal.addEventListener("abort", () => finish("decline"), { once: true });
			run.decision = finish;
		});
	const setStep = (step: string) => active && (active.step = step);
	const onDiscovered = (company: { metadata: { issuer: string } }) => (knowledge.issuer = company.metadata.issuer);
	const fault = FAULTS.find((f) => f.id === faultId);
	void (fault
		? runFault(agent, fault, { target, emit: send, setStep, onDiscovered })
		: runJourney(agent, { target, emit: send, setStep, publicTool, chat, fetch: seen, browse: browsePaths, signIn: signIn ? signInOptions(operation) : undefined, decide, signal: run.abort.signal, onDiscovered })
	)
		.catch((error) => {
			send({ type: "step.end", step: active?.step ?? "", ok: false, summary: [], error: String(error), at: Date.now() });
			return false;
		})
		.then((ok) => {
			send({ type: "run.end", ok, at: Date.now() });
			run.done = true;
			active = undefined;
		});
	return run;
}

// --- who is allowed in ---

interface UserSession {
	sub: string;
	email?: string;
	expires: number;
}
const sessions = new Map<string, UserSession>();
const SESSION_MS = 8 * 3_600_000;
const COOKIE = secure ? "__Host-inspector" : "inspector";
/** Holds the OIDC state of a login in progress, so only the browser that started it can finish it. */
const LOGIN_COOKIE = secure ? "__Host-inspector-login" : "inspector-login";

const cookieOf = (request: IncomingMessage, name: string) => request.headers.cookie?.split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];
const sessionOf = (request: IncomingMessage): UserSession | undefined => {
	const id = cookieOf(request, COOKIE);
	const session = id ? sessions.get(id) : undefined;
	if (session && session.expires < Date.now()) return void sessions.delete(id!);
	return session;
};
const cookieHeader = (name: string, value: string, maxAge: number) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

const tokenOk = (request: IncomingMessage) => {
	if (!token) return false;
	const given = Buffer.from((request.headers.authorization ?? "").replace(/^Bearer /, ""));
	const wanted = Buffer.from(token);
	return given.length === wanted.length && timingSafeEqual(given, wanted);
};
/** Development with nothing configured is open; otherwise a Curity session or the token. */
const authorized = (request: IncomingMessage) => (!oidc && !token ? true : tokenOk(request) || sessionOf(request) !== undefined);

/** A browser sends Origin on cross-site POSTs. Cookies are SameSite=Lax too; this is the second lock. */
const sameOrigin = (request: IncomingMessage) => {
	const origin = request.headers.origin;
	return !origin || origin === new URL(publicUrl).origin;
};

// --- http ---

const json = (response: ServerResponse, status: number, body: unknown) => {
	response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	response.end(JSON.stringify(body));
};
const page = (response: ServerResponse, status: number, message: string) => {
	response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
	response.end(`<!doctype html><meta charset="utf-8"><title>Poppy Inspector</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Poppy Inspector</h1><p>${message}</p><p><a href="/">Back</a></p>`);
};
const readJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 16_384) throw new Error("body too large");
		chunks.push(chunk);
	}
	return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {};
};

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".map": "application/json" };
const dist = resolve(import.meta.dirname, "../dist");

function serveStatic(url: URL, response: ServerResponse) {
	let file = join(dist, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
	if (!file.startsWith(dist)) return json(response, 403, { error: "forbidden" });
	if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html"); // single-page app
	if (!existsSync(file)) return json(response, 404, { error: "UI not built: run `pnpm --filter poppyseed-inspector build`" });
	response.writeHead(200, {
		"content-type": types[extname(file)] ?? "application/octet-stream",
		"x-content-type-options": "nosniff",
		"x-frame-options": "DENY",
		"referrer-policy": "no-referrer",
		// The UI is same-origin scripts and styles only. It talks to this server and nothing else.
		"content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
	});
	createReadStream(file).pipe(response);
}

createServer(async (request, response) => {
	const url = new URL(request.url ?? "/", publicUrl);
	try {
		// The agent's public identity: the target fetches these.
		if (request.method === "GET" && url.pathname === "/agent/client.json") return json(response, 200, agent.clientMetadata());
		if (request.method === "GET" && url.pathname === "/agent/jwks.json") return json(response, 200, agent.jwks());
		// Advertised in the client metadata; consent pages may fetch the logo, and the callback is never used.
		if (request.method === "GET" && url.pathname === "/agent/logo.png") {
			response.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
			return response.end(LOGO);
		}
		if (url.pathname === "/agent/callback") return json(response, 404, { error: "this agent does not receive redirects" });

		// Sign in with Curity.
		if (url.pathname === "/auth/info" && request.method === "GET") {
			const user = sessionOf(request);
			return json(response, 200, { oidc: Boolean(oidc), token: Boolean(token), ...(user ? { user: { sub: user.sub, ...(user.email ? { email: user.email } : {}) } } : {}) } satisfies AuthInfo);
		}
		if (url.pathname === "/auth/login" && request.method === "GET") {
			if (!oidc) return page(response, 404, "Sign in with Curity is not configured.");
			const { url: provider, state } = await oidc.begin();
			// Lax cookies are sent when the provider redirects back (a top-level GET), and not on a cross-site POST or subrequest.
			return void response.writeHead(302, { location: provider, "set-cookie": cookieHeader(LOGIN_COOKIE, state, 600), "cache-control": "no-store" }).end();
		}
		if (url.pathname === "/auth/callback" && request.method === "GET") {
			if (!oidc) return page(response, 404, "Sign in with Curity is not configured.");
			try {
				const user = await oidc.finish(url.searchParams, cookieOf(request, LOGIN_COOKIE));
				const id = randomBytes(32).toString("base64url");
				const now = Date.now();
				for (const [key, s] of sessions) if (s.expires < now) sessions.delete(key);
				sessions.set(id, { ...user, expires: now + SESSION_MS });
				return void response.writeHead(302, { location: "/", "set-cookie": [cookieHeader(COOKIE, id, SESSION_MS / 1000), cookieHeader(LOGIN_COOKIE, "", 0)], "cache-control": "no-store" }).end();
			} catch (error) {
				// Say what kind of failure it was, never the codes or tokens involved.
				console.error("[inspector] login failed:", error instanceof Error ? error.message : error);
				if (error instanceof NotAllowed) return page(response, 403, "You signed in, but this account is not allowed to use the inspector.");
				return page(response, error instanceof BadCallback ? 400 : 502, "Sign-in did not complete. Try again.");
			}
		}
		if (url.pathname === "/auth/logout" && request.method === "POST") {
			if (!sameOrigin(request)) return json(response, 403, { error: "cross-origin request" });
			const id = cookieOf(request, COOKIE);
			if (id) sessions.delete(id);
			response.setHeader("set-cookie", cookieHeader(COOKIE, "", 0));
			return json(response, 200, { ok: true });
		}

		if (url.pathname.startsWith("/api/")) {
			if (!authorized(request)) return json(response, 401, { error: "unauthorized" });
			if (request.method !== "GET" && !sameOrigin(request)) return json(response, 403, { error: "cross-origin request" });
			if (request.method === "GET" && url.pathname === "/api/config") return json(response, 200, { target, clientId, redacted: redact, faults: faultInfo, operations: operations.map(({ label }) => ({ label })) } satisfies InspectorConfig);
			if (request.method === "POST" && url.pathname === "/api/runs") {
				if (active) return json(response, 409, { error: "a run is already in progress", runId: active.run.id });
				const body = await readJson(request);
				if (body.fault !== undefined && !FAULTS.some((f) => f.id === body.fault)) return json(response, 400, { error: "unknown fault" });
				const index = body.operation === undefined ? 0 : body.operation;
				if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= operations.length) return json(response, 400, { error: "unknown operation" });
				return json(response, 201, { runId: startRun(body.signIn === true, typeof body.fault === "string" ? body.fault : undefined, operations[index]).id });
			}
			const routed = url.pathname.match(/^\/api\/runs\/([\w-]+)\/(events|poll|decision|cancel)$/);
			const run = routed && runs.get(routed[1]!);
			if (routed && !run) return json(response, 404, { error: "no such run" });
			// The page reads a run by short requests, each answered in full, so a proxy that holds back a stream cannot hide an event.
			if (run && routed?.[2] === "poll" && request.method === "GET") {
				const from = Math.max(0, Math.floor(Number(url.searchParams.get("from"))) || 0);
				const reply = () => {
					const events = run.events.slice(from, from + 200);
					const next = from + events.length;
					return json(response, 200, { events, next, done: next >= run.events.length && (run.done || run.events.at(-1)?.type === "run.end") });
				};
				if (run.events.length > from || run.done) return reply();
				// Nothing new yet: hold this request for up to 20 seconds, so a person's answer shows quickly and no request is long.
				const wake = () => {
					clearTimeout(timer);
					run.listeners.delete(wake);
					if (!response.writableEnded) reply();
				};
				const timer = setTimeout(wake, 20_000);
				run.listeners.add(wake);
				request.on("close", () => (clearTimeout(timer), run.listeners.delete(wake)));
				return;
			}
			if (run && routed?.[2] === "events" && request.method === "GET") {
				response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
				const write = (event: ProtocolEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`);
				run.events.forEach(write);
				if (run.done) return response.end();
				const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 20_000); // proxies close idle streams while a person decides
				const listener = (event: ProtocolEvent) => {
					write(event);
					if (event.type === "run.end") response.end();
				};
				run.listeners.add(listener);
				request.on("close", () => (run.listeners.delete(listener), clearInterval(keepAlive)));
				response.on("close", () => clearInterval(keepAlive));
				return;
			}
			if (run && routed?.[2] === "decision" && request.method === "POST") {
				const { decision } = await readJson(request);
				if (decision !== "approve" && decision !== "decline") return json(response, 400, { error: "decision must be approve or decline" });
				if (!run.decision) return json(response, 409, { error: "this run is not waiting for a decision" });
				run.decision(decision);
				return json(response, 200, { ok: true });
			}
			if (run && routed?.[2] === "cancel" && request.method === "POST") {
				run.abort.abort();
				return json(response, 200, { ok: true });
			}
			return json(response, 404, { error: "not found" });
		}
		if (request.method === "GET") return serveStatic(url, response);
		json(response, 405, { error: "method not allowed" });
	} catch (error) {
		console.error("[inspector]", error instanceof Error ? error.message : error); // never log request bodies or tokens
		if (!response.headersSent) json(response, 500, { error: "internal error" });
		else response.end();
	}
}).listen(port, () => console.log(`[inspector] http://localhost:${port} → ${target} as ${clientId}${redact ? "" : " (credentials NOT redacted)"} · login: ${[oidc && "Curity", token && "token", !oidc && !token && "open (development)"].filter(Boolean).join(" + ")}`));
