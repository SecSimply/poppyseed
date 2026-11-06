import { beforeEach, describe, expect, it } from "vitest";
import { block, blocked, MAX_BLOCKED, parseClientId, parseList, unblock } from "./blocklist.ts";

beforeEach(() => void (blocked.length = 0));

describe("blocklist", () => {
	it("reads URLs separated by spaces or commas, once each, and drops anything else", () => {
		expect(parseList("https://a.example/c.json, https://b.example/c.json\nhttps://a.example/c.json nonsense ftp://x.example/")).toEqual(["https://a.example/c.json", "https://b.example/c.json"]);
		expect(parseList(undefined)).toEqual([]);
	});

	it("accepts http and https URLs only", () => {
		expect(parseClientId("https://agent.example/client.json")).toBe("https://agent.example/client.json");
		expect(parseClientId("javascript:alert(1)")).toBeUndefined();
		expect(parseClientId("not a url")).toBeUndefined();
	});

	it("blocks and unblocks in the array the config reads", () => {
		const same = blocked;
		expect(block("https://a.example/c.json")).toBe(true);
		expect(block("https://a.example/c.json")).toBe(true);
		expect(same).toEqual(["https://a.example/c.json"]);
		unblock("https://a.example/c.json");
		expect(same).toEqual([]);
	});

	it("refuses what is not a URL, and stops at the limit", () => {
		expect(block("hello")).toBe(false);
		for (let i = 0; i < MAX_BLOCKED; i++) expect(block(`https://a${i}.example/c.json`)).toBe(true);
		expect(block("https://one-more.example/c.json")).toBe(false);
	});
});
