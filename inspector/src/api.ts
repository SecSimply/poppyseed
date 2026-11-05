import type { AuthInfo, InspectorConfig, ProtocolEvent } from "../shared/events.ts";

/** A browser signed in with Curity authenticates with its session cookie; a shared token, if used, goes in a header. */
const headers = (token: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

export class Unauthorized extends Error {}

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

/** Reads the run's server-sent events. fetch, not EventSource, so a token travels in a header and not the URL. */
export async function streamRun(token: string, runId: string, onEvent: (event: ProtocolEvent) => void, signal: AbortSignal): Promise<void> {
	const response = await fetch(`/api/runs/${runId}/events`, { headers: headers(token), signal });
	if (!response.ok || !response.body) throw new Error(`events: HTTP ${response.status}`);
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buffer += value;
		for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
			const chunk = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			const data = chunk.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
			if (data) onEvent(JSON.parse(data) as ProtocolEvent);
		}
	}
}
