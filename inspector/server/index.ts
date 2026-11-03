/**
 * Poppy Inspector backend. Runs one real Personal Agent (poppyseed/agent) against TARGET_URL, reports every
 * request it makes as a stream of events, and serves the built UI.
 *
 * The agent's identity is hosted here: /agent/client.json and /agent/jwks.json, on this server's own HTTPS origin,
 * so the target fetches them like any agent's. Nothing needs loosening on the target.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { TestAgent } from "poppyseed/agent";
import type { InspectorConfig, ProtocolEvent } from "../shared/events.ts";
import { capture } from "./capture.ts";
import { runJourney } from "./journey.ts";

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3001);
const target = (process.env.TARGET_URL ?? (production ? "" : "http://localhost:3000")).replace(/\/$/, "");
if (!target) throw new Error("Set TARGET_URL to the Poppyseed site to inspect");
const token = process.env.INSPECTOR_TOKEN ?? "";
if (production && token.length < 16) throw new Error("Set INSPECTOR_TOKEN (16+ characters) in production: this server holds a live agent identity");
const publicUrl = (process.env.INSPECTOR_PUBLIC_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`)).replace(/\/$/, "");
const redact = process.env.INSPECTOR_REVEAL !== "1";
const clientId = `${publicUrl}/agent/client.json`;

const publicTool = (() => {
	if (process.env.PUBLIC_TOOL) return { name: process.env.PUBLIC_TOOL, arguments: JSON.parse(process.env.PUBLIC_TOOL_ARGS ?? "{}") as Record<string, unknown> };
	// The Poppy Travel demo's tool; skipped when the target has no tool by this name.
	return { name: "search_flights", arguments: { from: "SFO", to: "LIS", date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) } };
})();

/** A 1x1 transparent PNG. */
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

interface Run {
	id: string;
	events: ProtocolEvent[];
	done: boolean;
	listeners: Set<(event: ProtocolEvent) => void>;
}
const runs = new Map<string, Run>();
let active: { run: Run; step: string } | undefined;

const emit = (run: Run) => (event: ProtocolEvent) => {
	run.events.push(event);
	for (const listener of run.listeners) listener(event);
};

const agent = await TestAgent.create({
	clientId,
	clientName: "Poppy Inspector",
	allowInsecure: target.startsWith("http://"),
	extensions: { operations: { version: "1" } },
	fetch: (input, init) =>
		capture(
			globalThis.fetch.bind(globalThis),
			(event) => active && emit(active.run)(event),
			() => active?.step ?? "",
			redact,
		)(input, init),
});

async function startRun(): Promise<Run> {
	const run: Run = { id: randomUUID(), events: [], done: false, listeners: new Set() };
	runs.set(run.id, run);
	for (const id of [...runs.keys()].slice(0, Math.max(0, runs.size - 20))) runs.delete(id); // keep the last 20
	active = { run, step: "" };
	const send = emit(run);
	send({ type: "run.start", runId: run.id, target, clientId, redacted: redact, at: Date.now() });
	void runJourney(agent, { target, emit: send, setStep: (step) => active && (active.step = step), publicTool })
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

const authorized = (request: IncomingMessage) => {
	if (!token) return true; // development only: production refuses to start without a token
	const given = Buffer.from((request.headers.authorization ?? "").replace(/^Bearer /, ""));
	const wanted = Buffer.from(token);
	return given.length === wanted.length && timingSafeEqual(given, wanted);
};

const json = (response: ServerResponse, status: number, body: unknown) => {
	response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	response.end(JSON.stringify(body));
};

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".map": "application/json" };
const dist = resolve(import.meta.dirname, "../dist");

function serveStatic(url: URL, response: ServerResponse) {
	let file = join(dist, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
	if (!file.startsWith(dist)) return json(response, 403, { error: "forbidden" });
	if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html"); // single-page app
	if (!existsSync(file)) return json(response, 404, { error: "UI not built: run `pnpm --filter poppyseed-inspector build`" });
	response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff" });
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

		if (url.pathname.startsWith("/api/")) {
			if (!authorized(request)) return json(response, 401, { error: "unauthorized" });
			if (request.method === "GET" && url.pathname === "/api/config") return json(response, 200, { target, clientId, redacted: redact } satisfies InspectorConfig);
			if (request.method === "POST" && url.pathname === "/api/runs") {
				if (active) return json(response, 409, { error: "a run is already in progress", runId: active.run.id });
				return json(response, 201, { runId: (await startRun()).id });
			}
			const stream = url.pathname.match(/^\/api\/runs\/([\w-]+)\/events$/);
			if (request.method === "GET" && stream) {
				const run = runs.get(stream[1]!);
				if (!run) return json(response, 404, { error: "no such run" });
				response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
				const write = (event: ProtocolEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`);
				run.events.forEach(write);
				if (run.done) return response.end();
				const listener = (event: ProtocolEvent) => {
					write(event);
					if (event.type === "run.end") response.end();
				};
				run.listeners.add(listener);
				request.on("close", () => run.listeners.delete(listener));
				return;
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
}).listen(port, () => console.log(`[inspector] http://localhost:${port} → ${target} as ${clientId}${redact ? "" : " (credentials NOT redacted)"}`));
