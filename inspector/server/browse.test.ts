import { describe, expect, it } from "vitest";
import { browse, parsePaths, readPage } from "./browse.ts";

const page = (body: string) => `<!doctype html><html><head><title>Account &amp; more · Bank</title><style>.a{color:red}</style></head><body><nav>Home</nav><main><h1>Thandi</h1><script>alert(1)</script><p>R97&nbsp;892,35 &lt;b&gt;</p></main></body></html>${body}`;

describe("readPage", () => {
	it("keeps the title and the text of <main>, with no markup or script", () => {
		const p = readPage(page(""));
		expect(p.title).toBe("Account & more · Bank");
		expect(p.excerpt).toBe("Thandi R97 892,35 <b>");
		expect(p.excerpt).not.toMatch(/alert|color:red|Home/);
	});
	it("shortens long text", () => {
		expect(readPage(`<main>${"word ".repeat(200)}</main>`, 20).excerpt).toBe("word word word word …");
	});
});

describe("parsePaths", () => {
	it("takes paths that start with one slash, once each, and defaults to the home page", () => {
		expect(parsePaths("/account, /payments /account //evil.example http://x.example nope")).toEqual(["/account", "/payments"]);
		expect(parsePaths(undefined)).toEqual(["/"]);
		expect(parsePaths("nonsense")).toEqual(["/"]);
	});
});

describe("browse", () => {
	const site = (join: number, pages: Record<string, Response>) => ({
		target: "https://bank.example",
		join: async () => new Response(null, { status: join }),
		get: async (url: string) => pages[new URL(url).pathname] ?? new Response("", { status: 404 }),
	});

	it("joins, then reports each page's status and text", async () => {
		const lines = await browse(site(303, { "/account": new Response(page(""), { status: 200 }), "/staff": new Response(null, { status: 307, headers: { location: "/login" } }) }), ["/account", "/staff", "/nowhere"]);
		expect(lines[0]).toBe("the browser joined the Session (HTTP 303)");
		expect(lines).toContain('GET /account → 200 "Account & more · Bank"');
		expect(lines).toContain("  Thandi R97 892,35 <b>");
		expect(lines).toContain("GET /staff → 307 to /login");
		expect(lines).toContain("GET /nowhere → 404");
	});

	it("fails when the company will not let the browser join", async () => {
		await expect(browse(site(400, {}), ["/"])).rejects.toThrow(/did not let the browser join.*400/);
	});

	it("will not leave the company's site", async () => {
		await expect(browse(site(303, {}), ["//evil.example/x"])).rejects.toThrow(/not a page on/);
	});
});
