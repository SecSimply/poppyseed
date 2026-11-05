import { timingSafeEqual } from "node:crypto";

/** The staff key from the environment. In production there is no default: without it the console does not exist. */
export const staffKey = (): string | undefined => process.env.POPPY_STAFF_KEY ?? (process.env.NODE_ENV !== "production" ? "staff" : undefined);

/** Whether a candidate is the staff key. Compared in constant time, and false when there is no key to compare with. */
export function isStaff(candidate: unknown, expected: string | undefined = staffKey()): candidate is string {
	if (!expected || typeof candidate !== "string") return false;
	const a = Buffer.from(candidate);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
