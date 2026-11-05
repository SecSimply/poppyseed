import { PapError, type Discovery, type TestAgent } from "poppyseed/agent";
import { describe, expect, it } from "vitest";
import type { ProtocolEvent } from "../shared/events.ts";
import { FAULTS, faultInfo, runFault } from "./faults.ts";

/** An agent that stands in for a company with chosen behaviour: it refuses requests in `refusing`, in order. */
function fakeAgent(plan: { control?: "ok" | PapError; attempts: ("ok" | PapError)[] }) {
	let call = 0;
	const next = async (outcome: "ok" | PapError | undefined) => {
		if (outcome instanceof PapError) throw outcome;
		return { token_type: "DPoP", expires_in: 3600, access_token: "t" };
	};
	const company = { metadata: { issuer: "https://company.example", token_endpoint: "https://company.example/token" } } as unknown as Discovery;
	return {
		discover: async () => company,
		endpoint: () => "https://company.example/mcp",
		newSessionKey: async () => ({ keys: { publicJwk: {} } }),
		// The first call is the control; later ones are the fault's attempts.
		startSession: async () => (call++ === 0 ? next(plan.control) : next(plan.attempts[call - 2])),
	} as unknown as TestAgent;
}

async function play(faultId: string, plan: Parameters<typeof fakeAgent>[0]) {
	const events: ProtocolEvent[] = [];
	const fault = FAULTS.find((f) => f.id === faultId)!;
	const ok = await runFault(fakeAgent(plan), fault, { target: "https://company.example", emit: (e) => events.push(e), setStep: () => {}, onDiscovered: () => {} });
	const ends = events.filter((e): e is Extract<ProtocolEvent, { type: "step.end" }> => e.type === "step.end");
	return { ok, ends };
}

const refusal = (status: number) => new PapError(status, { error: "invalid_grant", error_description: "no" }, null);

describe("runFault", () => {
	it("passes when the company refuses the broken request", async () => {
		const { ok, ends } = await play("assertion-expired", { attempts: [refusal(400)] });
		expect(ok).toBe(true);
		expect(ends.at(-1)?.summary[0]).toMatch(/refused as required: HTTP 400 invalid_grant/);
	});

	it("fails, loudly, when the company accepts a request it must refuse", async () => {
		const { ok, ends } = await play("assertion-expired", { attempts: ["ok"] });
		expect(ok).toBe(false);
		expect(ends.at(-1)?.error).toMatch(/ACCEPTED/);
	});

	it("does not count a server error as a refusal", async () => {
		const { ok, ends } = await play("assertion-expired", { attempts: [refusal(500)] });
		expect(ok).toBe(false);
		expect(ends.at(-1)?.error).toMatch(/failed instead of refusing/);
	});

	it("stops at the control when a valid request is refused, so a broken setup is not blamed on the fault", async () => {
		const { ok, ends } = await play("assertion-expired", { control: refusal(401), attempts: [] });
		expect(ok).toBe(false);
		expect(ends.map((e) => e.step)).toEqual(["discover", "control"]);
	});

	it("expects a replay to be accepted once and refused the second time", async () => {
		expect((await play("assertion-replay", { attempts: ["ok", refusal(400)] })).ok).toBe(true);
		const accepted = await play("assertion-replay", { attempts: ["ok", "ok"] });
		expect(accepted.ok).toBe(false);
		expect(accepted.ends.at(-1)?.step).toBe("attempt-2");
		const refusedFirst = await play("assertion-replay", { attempts: [refusal(400)] });
		expect(refusedFirst.ok).toBe(false);
		expect(refusedFirst.ends.at(-1)?.error).toMatch(/should accept/);
	});
});

describe("the fault list", () => {
	it("has a unique id, a title and a rule for each fault", () => {
		expect(new Set(faultInfo.map((f) => f.id)).size).toBe(faultInfo.length);
		for (const f of faultInfo) expect(f.title && f.rule).toBeTruthy();
	});
});
