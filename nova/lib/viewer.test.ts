import { describe, expect, it } from "vitest";
import { mayRead, viewerOf } from "./viewer.ts";

const session = (account: { id: string; scopes: string[] } | null) => ({ sessionId: "s", clientId: "https://agent.example/c", userId: "u", account });

describe("viewerOf", () => {
	it("is nobody without a session or a login", () => {
		expect(viewerOf(null, null)).toEqual({ via: "nobody" });
	});
	it("is the customer in a browser with the site login", () => {
		const v = viewerOf(null, "nb_session=cus_ada");
		expect(v).toMatchObject({ via: "site", customer: { id: "cus_ada" } });
	});
	it("is the agent while its Session cookie is present, whatever login the browser also holds", () => {
		const v = viewerOf(session({ id: "cus_ben", scopes: ["accounts:read"] }), "nb_session=cus_ada");
		expect(v).toMatchObject({ via: "agent", customer: { id: "cus_ben" }, scopes: ["accounts:read"] });
	});
	it("is a signed-out agent when its Session is not signed in", () => {
		expect(viewerOf(session(null), "nb_session=cus_ada")).toEqual({ via: "agent", clientId: "https://agent.example/c", customer: undefined, scopes: [] });
	});
});

describe("mayRead", () => {
	it("lets a customer in their own browser read everything of theirs", () => {
		expect(mayRead(viewerOf(null, "nb_session=cus_ada"), "transactions:read")).toBe(true);
	});
	it("lets an agent read only what its scopes allow", () => {
		const v = viewerOf(session({ id: "cus_ada", scopes: ["accounts:read"] }), null);
		expect(mayRead(v, "accounts:read")).toBe(true);
		expect(mayRead(v, "transactions:read")).toBe(false);
	});
	it("lets a signed-out agent and a stranger read nothing", () => {
		expect(mayRead(viewerOf(session(null), null), "accounts:read")).toBe(false);
		expect(mayRead({ via: "nobody" }, "accounts:read")).toBe(false);
	});
});
