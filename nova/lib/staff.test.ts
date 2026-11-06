import { describe, expect, it } from "vitest";
import { sealSession, SESSION_COOKIE } from "./session.ts";
import { isStaff, staffAccess } from "./staff.ts";

describe("isStaff", () => {
	it("accepts exactly the key", () => {
		expect(isStaff("s3cret-key", "s3cret-key")).toBe(true);
	});

	it.each(["s3cret-keY", "s3cret-key ", "s3cret", "", "S3CRET-KEY"])("refuses %j", (candidate) => {
		expect(isStaff(candidate, "s3cret-key")).toBe(false);
	});

	it("refuses anything that is not a string, and everything when there is no key", () => {
		expect(isStaff(undefined, "k")).toBe(false);
		expect(isStaff(null, "k")).toBe(false);
		expect(isStaff(["k"], "k")).toBe(false);
		expect(isStaff("k", undefined)).toBe(false);
		expect(isStaff("", undefined)).toBe(false);
	});
});

describe("staffAccess", () => {
	const cookie = (staff: boolean) => `${SESSION_COOKIE}=${sealSession({ sub: "s9", email: "sam@bank.example", name: "Sam", staff })}`;

	it("lets a staff session in, as that person", () => {
		const who = staffAccess(cookie(true), undefined);
		expect(who).toMatchObject({ by: "session", name: "Sam" });
		expect(who?.id).toMatch(/^aut_[0-9a-f]{12}$/);
	});

	it("does not let a customer's session in, with or without a wrong key", () => {
		expect(staffAccess(cookie(false), undefined)).toBeUndefined();
		expect(staffAccess(cookie(false), "not-the-key")).toBeUndefined();
	});

	it("lets the emergency key in, as the support team, when there is no session", () => {
		process.env.POPPY_STAFF_KEY = "emergency-key-123";
		try {
			expect(staffAccess(null, "emergency-key-123")).toEqual({ by: "key", id: "aut_support", name: "Protea Bank support" });
			expect(staffAccess(null, "emergency-key-12")).toBeUndefined();
			expect(staffAccess(cookie(false), "emergency-key-123")?.by).toBe("key");
		} finally {
			delete process.env.POPPY_STAFF_KEY;
		}
	});

	it("lets nobody in with no session and no key", () => {
		expect(staffAccess(null, undefined)).toBeUndefined();
		expect(staffAccess("pb_session=forged", "")).toBeUndefined();
	});
});
