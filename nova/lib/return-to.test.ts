import { describe, expect, it } from "vitest";
import { safeReturn } from "./return-to.ts";

const BASE = "https://nova.example";

describe("safeReturn", () => {
	it("keeps a path on this site, with its query", () => {
		expect(safeReturn("/oauth/authorize?client_id=x&state=y", BASE)).toBe("/oauth/authorize?client_id=x&state=y");
		expect(safeReturn("https://nova.example/account", BASE)).toBe("/account");
	});

	it.each([
		"https://evil.example/",
		"//evil.example",
		"/\\evil.example",
		"https://nova.example.evil.example/",
		"https://nova.example@evil.example/",
		"javascript:alert(1)",
		"http://nova.example/",
	])("refuses %s", (candidate) => {
		expect(safeReturn(candidate, BASE)).toBe("/account");
	});

	it("falls back when there is nothing to return to", () => {
		expect(safeReturn(undefined, BASE)).toBe("/account");
		expect(safeReturn("", BASE)).toBe("/account");
	});
});
