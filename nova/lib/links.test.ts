/** One contract, run against both stores. Postgres runs on PGlite. */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { memoryLinks, postgresLinks, type Links } from "./links.ts";

const stores: [string, () => Promise<Links>][] = [
	["memory", async () => memoryLinks()],
	// A fresh database per test: the tables are fixed names.
	["postgres", async () => { const fresh = new PGlite(); await fresh.waitReady; return postgresLinks(fresh); }],
];

describe.each(stores)("%s links", (_name, make) => {
	it("knows a login's customer only once it is linked, and by sub", async () => {
		const links = await make();
		expect(await links.customerFor("sub-1")).toBeUndefined();
		await links.link({ sub: "sub-1", email: "t@example.com", name: "T" }, "cus_thandi", "Sam");
		expect(await links.customerFor("sub-1")).toBe("cus_thandi");
		expect(await links.customerFor("sub-2")).toBeUndefined();
		expect(await links.linked()).toMatchObject([{ sub: "sub-1", email: "t@example.com", customerId: "cus_thandi", linkedBy: "Sam" }]);
	});

	it("moves a pending login to linked, and forgets it when unlinked", async () => {
		const links = await make();
		await links.notePending({ sub: "sub-1", email: "t@example.com" });
		expect((await links.pending()).map((p) => p.sub)).toEqual(["sub-1"]);
		await links.link({ sub: "sub-1", email: "t@example.com" }, "cus_pieter", "Sam");
		expect(await links.pending()).toEqual([]);
		await links.unlink("sub-1");
		expect(await links.customerFor("sub-1")).toBeUndefined();
		expect(await links.linked()).toEqual([]);
	});

	it("relinks a login to another customer", async () => {
		const links = await make();
		await links.link({ sub: "sub-1" }, "cus_thandi", "Sam");
		await links.link({ sub: "sub-1" }, "cus_pieter", "Lee");
		expect(await links.customerFor("sub-1")).toBe("cus_pieter");
		expect(await links.linked()).toHaveLength(1);
	});

	it("keeps only the newest 50 pending logins", async () => {
		const links = await make();
		for (let i = 0; i < 55; i++) await links.notePending({ sub: `sub-${i}` });
		const pending = await links.pending();
		expect(pending).toHaveLength(50);
		expect(pending.some((p) => p.sub === "sub-0")).toBe(false);
		expect(pending.some((p) => p.sub === "sub-54")).toBe(true);
	});
});
