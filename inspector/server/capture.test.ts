import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { ProtocolEvent } from "../shared/events.ts";
import { capture } from "./capture.ts";

const pair = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(pair.publicKey);
const proof = (claims: Record<string, unknown>) => new SignJWT({ jti: "j".repeat(22), iat: Math.floor(Date.now() / 1000), ...claims }).setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk }).sign(pair.privateKey);

const run = async (respond: () => Response, headers: Record<string, string>) => {
	const events: ProtocolEvent[] = [];
	const fetcher = capture(async () => respond(), (e) => events.push(e), () => "session", true, { issuer: "https://company.example" });
	await fetcher("https://company.example/oauth/token", { method: "POST", headers, body: "a=b" });
	return events.find((e): e is Extract<ProtocolEvent, { type: "http" }> => e.type === "http")!;
};

describe("capture", () => {
	it("attaches the decoded proof and likely causes to a refused request, and keeps the proof itself redacted", async () => {
		const dpop = await proof({ htm: "POST", htu: "https://elsewhere.example/token" });
		const event = await run(() => Response.json({ error: "invalid_dpop_proof", error_description: "htu does not match the request URL" }, { status: 400 }), { dpop });
		expect(event.jwts?.[0]?.checks.find((c) => c.name === "htu")?.status).toBe("fail");
		expect(event.hints?.[0]).toMatch(/htu/);
		expect(event.request.headers.dpop).not.toBe(dpop);
		expect(event.request.headers.dpop).toContain("redacted");
		expect(JSON.stringify(event)).not.toContain(dpop.split(".")[2]!);
	});

	it("adds neither for an ordinary successful request", async () => {
		const event = await run(() => Response.json({ ok: true }), {});
		expect(event.jwts).toBeUndefined();
		expect(event.hints).toBeUndefined();
	});

	it("decodes the proof the same way when credentials are not redacted", async () => {
		const events: ProtocolEvent[] = [];
		const fetcher = capture(async () => Response.json({}), (e) => events.push(e), () => "s", false);
		await fetcher("https://company.example/x", { method: "POST", headers: { dpop: await proof({ htm: "POST", htu: "https://company.example/x" }) } });
		expect((events[0] as Extract<ProtocolEvent, { type: "http" }>).jwts).toHaveLength(1);
	});
});
