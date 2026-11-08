/** A hosted agent keeps one TestAgent per person and must give each its own, stable user id. */
import { expect, it } from "vitest";
import { TestAgent } from "../src/agent/index.ts";

it("uses the user id it was given, for each person", async () => {
	const options = { clientId: "https://agent.example/client.json" };
	const [a, b] = await Promise.all([TestAgent.create({ ...options, userId: "usr_a" }), TestAgent.create({ ...options, userId: "usr_b" })]);
	expect(a.userId).toBe("usr_a");
	expect(b.userId).toBe("usr_b");
});
