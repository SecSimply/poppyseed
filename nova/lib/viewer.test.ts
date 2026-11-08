import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, sealSession, type Session } from "./session.ts";
import { customerOf, mayRead, viewerOf } from "./viewer.ts";

const cookieOf = (s: Session) => `${SESSION_COOKIE}=${sealSession(s)}`;
const thandi = cookieOf({ sub: "s1", email: "thandi@proteabank.example", customerId: "cus_thandi", staff: false });
/** Signed in at Curity, but not mapped to a customer. */
const stranger = cookieOf({ sub: "s2", email: "someone@example.com", name: "Some One", staff: false });

const session = (account: { id: string; scopes: string[] } | null) => ({ sessionId: "s", clientId: "https://agent.example/c", userId: "u", account });

describe("viewerOf", () => {
	it("is nobody without a session or a login", async () => {
		expect(await viewerOf(null, null)).toEqual({ via: "nobody" });
	});
	it("is the customer in a browser with the site login", async () => {
		const v = await viewerOf(null, thandi);
		expect(v).toMatchObject({ via: "site", customer: { id: "cus_thandi" } });
	});
	it("is a visitor, with no accounts, for a signed-in person who is not a customer", async () => {
		const v = await viewerOf(null, stranger);
		expect(v).toEqual({ via: "visitor", label: "Some One" });
		expect(customerOf(v)).toBeUndefined();
		expect(mayRead(v, "accounts:read")).toBe(false);
	});
	it("ignores a session cookie that is forged or from another secret", async () => {
		expect(await viewerOf(null, `${SESSION_COOKIE}=${sealSession({ sub: "x", customerId: "cus_thandi", staff: false }, { secret: "another-secret-another-secret-0123456789" })}`)).toEqual({ via: "nobody" });
		expect(await viewerOf(null, `${SESSION_COOKIE}=cus_thandi`)).toEqual({ via: "nobody" });
	});
	it("is the agent while its Session cookie is present, whatever login the browser also holds", async () => {
		const v = await viewerOf(session({ id: "cus_pieter", scopes: ["accounts:read"] }), thandi);
		expect(v).toMatchObject({ via: "agent", customer: { id: "cus_pieter" }, scopes: ["accounts:read"] });
	});
	it("is a signed-out agent when its Session is not signed in", async () => {
		expect(await viewerOf(session(null), thandi)).toEqual({ via: "agent", clientId: "https://agent.example/c", customer: undefined, scopes: [] });
	});
});

describe("mayRead", () => {
	it("lets a customer in their own browser read everything of theirs", async () => {
		expect(mayRead(await viewerOf(null, thandi), "transactions:read")).toBe(true);
	});
	it("lets an agent read only what its scopes allow", async () => {
		const v = await viewerOf(session({ id: "cus_thandi", scopes: ["accounts:read"] }), null);
		expect(mayRead(v, "accounts:read")).toBe(true);
		expect(mayRead(v, "transactions:read")).toBe(false);
	});
	it("lets a signed-out agent and a stranger read nothing", async () => {
		expect(mayRead(await viewerOf(session(null), null), "accounts:read")).toBe(false);
		expect(mayRead({ via: "nobody" }, "accounts:read")).toBe(false);
	});

	it("says when a login has no customer because Curity does not vouch for its email", async () => {
		const v = await viewerOf(null, cookieOf({ sub: "s3", email: "t@gmail.com", emailUnverified: true, staff: false }));
		expect(v).toEqual({ via: "visitor", label: "t@gmail.com", emailUnverified: true });
	});
});
