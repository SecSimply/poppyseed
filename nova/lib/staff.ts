import { createHash, timingSafeEqual } from "node:crypto";
import { sessionFrom } from "./session.ts";

/** The staff key from the environment: the way in when Curity is down, or no one is on STAFF_EMAILS yet. In production there is no default: without it, only a staff session gets in. */
export const staffKey = (): string | undefined => process.env.POPPY_STAFF_KEY ?? (process.env.NODE_ENV !== "production" ? "staff" : undefined);

/** Whether a candidate is the staff key. Compared in constant time, and false when there is no key to compare with. */
export function isStaff(candidate: unknown, expected: string | undefined = staffKey()): candidate is string {
	if (!expected || typeof candidate !== "string") return false;
	const a = Buffer.from(candidate);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Who is using the support console, and how they got in: a staff session from Curity, or the emergency key. */
export interface StaffAccess {
	by: "session" | "key";
	/** The author id and name on a reply, and the name in the action log. */
	id: string;
	name: string;
}

/**
 * Whether this request may use the console. A signed-in staff member may, by session. Otherwise the emergency key
 * may, as before. Checked again in every action: an action can be called without loading the page.
 */
export function staffAccess(cookieHeader: string | null | undefined, key: unknown): StaffAccess | undefined {
	const session = sessionFrom(cookieHeader);
	if (session?.staff) return { by: "session", id: `aut_${createHash("sha256").update(session.sub).digest("hex").slice(0, 12)}`, name: session.name ?? session.email ?? "Protea Bank staff" };
	if (isStaff(key)) return { by: "key", id: "aut_support", name: "Protea Bank support" };
	return undefined;
}
