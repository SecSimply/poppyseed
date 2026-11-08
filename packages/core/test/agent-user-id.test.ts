/** A hosted agent keeps one TestAgent per person and must give each its own, stable user id. */
import { decodeProtectedHeader, exportJWK, generateKeyPair } from "jose";
import { expect, it } from "vitest";
import { TestAgent } from "../src/agent/index.ts";

it("uses the user id it was given, for each person", async () => {
	const options = { clientId: "https://agent.example/client.json" };
	const [a, b] = await Promise.all([TestAgent.create({ ...options, userId: "usr_a" }), TestAgent.create({ ...options, userId: "usr_b" })]);
	expect(a.userId).toBe("usr_a");
	expect(b.userId).toBe("usr_b");
});

it("signs assertions with the kid of its own key", async () => {
	const pair = await generateKeyPair("ES256", { extractable: true });
	const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k7", alg: "ES256", use: "sig" };
	const keys = { ...pair, publicJwk, privateJwk: await exportJWK(pair.privateKey) };
	const agent = new TestAgent({ clientId: "https://agent.example/client.json" }, { signing: keys, stranger: keys });
	const header = decodeProtectedHeader(await agent.signAssertion("https://agent.example/client.json", "https://bank.example"));
	expect(header.kid).toBe("k7");
});
