import type { AuthInfo, InspectorConfig, ProtocolEvent } from "../shared/events.ts";

/** A browser signed in with Curity authenticates with its session cookie; a shared token, if used, goes in a header. */
const headers = (token: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

export class Unauthorized extends Error {}
/** The run is no longer on the server, which happens when the inspector restarts. */
export class Gone extends Error {
	constructor() {
		super("This run is gone: the inspector restarted. Run it again.");
	}
}

async function call(path: string, token: string, init: RequestInit = {}) {
	const response = await fetch(path, { ...init, headers: { ...headers(token), ...(init.body ? { "content-type": "application/json" } : {}) } });
	if (response.status === 401) throw new Unauthorized();
	return response;
}

export async function getAuthInfo(): Promise<AuthInfo> {
	return (await fetch("/auth/info")).json();
}

export async function logout(): Promise<void> {
	await fetch("/auth/logout", { method: "POST" });
}

export async function getConfig(token: string): Promise<InspectorConfig> {
	const response = await call("/api/config", token);
	if (!response.ok) throw new Error(`config: HTTP ${response.status}`);
	return response.json();
}

export async function startRun(token: string, signIn: boolean, fault?: string, operation?: number): Promise<string> {
	const response = await call("/api/runs", token, { method: "POST", body: JSON.stringify({ signIn, ...(fault ? { fault } : {}), ...(operation !== undefined ? { operation } : {}) }) });
	const body = await response.json();
	if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
	return body.runId;
}

export async function decide(token: string, runId: string, decision: "approve" | "decline"): Promise<void> {
	const response = await call(`/api/runs/${runId}/decision`, token, { method: "POST", body: JSON.stringify({ decision }) });
	if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
}

export async function cancelRun(token: string, runId: string): Promise<void> {
	await call(`/api/runs/${runId}/cancel`, token, { method: "POST" });
}

const pause = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
	});

/**
 * Reads a run's events by polling. Each request returns whole events and where to resume, so a dropped connection or
 * a proxy that holds a stream back loses nothing: the next request carries on from the last event received.
 */
export async function streamRun(token: string, runId: string, onEvent: (event: ProtocolEvent) => void, signal: AbortSignal, retryMs = 1000): Promise<void> {
	let from = 0;
	let failures = 0;
	while (!signal.aborted) {
		let page: { events: ProtocolEvent[]; next: number; done: boolean };
		try {
			const response = await fetch(`/api/runs/${runId}/poll?from=${from}`, { headers: headers(token), signal });
			if (response.status === 401) throw new Unauthorized();
			if (response.status === 404) throw new Gone();
			if (!response.ok) throw new Error(`events: HTTP ${response.status}`);
			page = await response.json();
			failures = 0;
		} catch (error) {
			if (signal.aborted) return;
			if (error instanceof Unauthorized || error instanceof Gone || ++failures > 20) throw error;
			await pause(retryMs * Math.min(failures, 5), signal);
			continue;
		}
		for (const event of page.events) onEvent(event);
		from = page.next;
		if (page.done) return;
	}
}
