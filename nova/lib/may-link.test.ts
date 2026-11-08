import { describe, expect, it } from "vitest";
import { mayLink } from "./staff.ts";

describe("who may link a login to a customer", () => {
	it("is a staff member signed in with Curity, and not the emergency key", () => {
		expect(mayLink({ by: "session", id: "aut_1", name: "Sam" })).toBe(true);
		expect(mayLink({ by: "key", id: "aut_support", name: "Protea Bank support" })).toBe(false);
	});
});
