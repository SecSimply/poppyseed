import type { StaffAccess } from "./staff.ts";

/** What staff did in the console: who, how they got in, and what. In memory, newest first, and gone on a restart. */
export interface Entry {
	at: string;
	who: string;
	by: StaffAccess["by"];
	what: string;
}

declare global {
	var __proteaAudit: Entry[] | undefined;
}
export const MAX_ENTRIES = 100;
export const entries: Entry[] = (globalThis.__proteaAudit ??= []);

export function record(who: StaffAccess, what: string, now = new Date()): void {
	entries.unshift({ at: now.toISOString(), who: who.name, by: who.by, what: what.slice(0, 200) });
	entries.length = Math.min(entries.length, MAX_ENTRIES);
}
