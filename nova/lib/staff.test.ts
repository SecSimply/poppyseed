import { describe, expect, it } from "vitest";
import { isStaff } from "./staff.ts";

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
