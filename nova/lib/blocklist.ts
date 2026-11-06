/**
 * Personal agents Protea Bank refuses, by client_id (the URL of the agent's metadata). Seeded from the
 * BLOCKED_CLIENTS variable (URLs separated by spaces or commas) and changed by staff at /staff. One array per process,
 * which `clients.block` reads on every request for a Session, so a change applies to the agent's next Session.
 * It lives in memory: a restart goes back to the variable.
 */
declare global {
	var __proteaBlocked: string[] | undefined;
}

export const MAX_BLOCKED = 50;

/** A client_id is an https URL, or http only for a local agent in development. Anything else is not blocked by name. */
export function parseClientId(text: string): string | undefined {
	try {
		const url = new URL(text.trim());
		return (url.protocol === "https:" || url.protocol === "http:") && url.hostname && text.trim().length <= 2000 ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

export const parseList = (text: string | undefined): string[] => [...new Set((text ?? "").split(/[\s,]+/).map(parseClientId).filter((u): u is string => !!u))];

export const blocked: string[] = (globalThis.__proteaBlocked ??= parseList(process.env.BLOCKED_CLIENTS));

/** Adds a client_id; returns false when it is not a URL or the list is full. Adding twice changes nothing. */
export function block(text: string): boolean {
	const id = parseClientId(text);
	if (!id) return false;
	if (blocked.includes(id)) return true;
	if (blocked.length >= MAX_BLOCKED) return false;
	blocked.push(id);
	return true;
}

export function unblock(text: string): void {
	const at = blocked.indexOf(text);
	if (at >= 0) blocked.splice(at, 1);
}
