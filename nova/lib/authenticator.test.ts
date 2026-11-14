/** The app's side of the bank, with a fake phone that signs as the Android app does. */
import { describe, expect, it } from "vitest";
import { approve, decline, detail, enroll, list, signinCode, type AuthenticatorDeps, type HostOperation } from "./authenticator.ts";
import { CLOCK_SKEW_MS, termsHash } from "./device-auth.ts";
import { memoryDevices, type Devices } from "./devices.ts";
import { FakePhone } from "./fake-phone.ts";
import { PhoneSigninError } from "./phone-signin.ts";

const ORIGIN = "https://bank.test";
const AGENT = "https://agent.test/client.json";

/** Operations as the bank's Poppy instance keeps them: open until approved or declined, owned by one customer. */
function fakeOperations() {
	const ops = new Map<string, HostOperation & { customerId: string }>();
	const approved: string[] = [];
	const api: AuthenticatorDeps["operations"] = {
		async get(id, accountId) {
			const op = ops.get(id);
			return op && (accountId === undefined || op.customerId === accountId) ? { ...op } : undefined;
		},
		async pending(accountId) {
			return [...ops.values()].filter((o) => o.customerId === accountId && o.state === "proposed").reverse().map((o) => ({ ...o }));
		},
		async approve(id, accountId, revision) {
			const op = ops.get(id);
			if (!op || op.customerId !== accountId) throw new Error("not found");
			if (op.state === "proposed" && op.revision === revision) {
				op.state = "in_progress";
				approved.push(id);
			}
			return { ...op };
		},
		async decline(id, accountId) {
			const op = ops.get(id);
			if (!op || op.customerId !== accountId) throw new Error("not found");
			if (op.state === "proposed") Object.assign(op, { state: "cancelled", result: { summary: "Declined by the account holder. Nothing was done." } });
			return { ...op };
		},
	};
	const add = (id: string, customerId: string, over: Partial<HostOperation> = {}) => {
		const op = { operation_id: id, revision: 1, state: "proposed", summary: "Pay R10,00 to Boland Power", terms: { amount: "10.00" }, expires_at: new Date(Date.now() + 600_000).toISOString(), client_id: AGENT, result: null, customerId, ...over };
		ops.set(id, op);
		return op;
	};
	return { api, add, ops, approved };
}

async function setup() {
	const devices: Devices = memoryDevices();
	const operations = fakeOperations();
	const deps: AuthenticatorDeps = { devices, operations: operations.api, origin: ORIGIN, agents: async () => [{ clientId: AGENT, clientName: "Claude bridge" }], customerName: async (id) => (id === "cus_a" ? "Ann" : undefined) };
	return { devices, deps, ...operations };
}

/** Enrolls and confirms a phone for a customer, as the app and the website do. */
async function enrolled(deps: AuthenticatorDeps, customerId = "cus_a", encoding: "raw" | "der" = "der") {
	const phone = new FakePhone("Pixel", encoding);
	const started = await deps.devices.startEnrollment(customerId);
	if (!started.ok) throw new Error(started.reason);
	const res = await enroll(new Request(`${ORIGIN}/authenticator/enroll`, { method: "POST", body: JSON.stringify({ enrollment_id: started.id, secret: started.secret, name: phone.name, auth_key: phone.keys.authKey, approval_key: phone.keys.approvalKey }) }), deps);
	const body = (await res.json()) as { device_id: string };
	phone.deviceId = body.device_id;
	await deps.devices.confirm(customerId, phone.deviceId);
	return phone;
}

const approvalBody = (phone: FakePhone, op: HostOperation, over: { revision?: number; hash?: string; opId?: string; time?: number; nonce?: string; withAuthKey?: boolean } = {}) =>
	JSON.stringify({ revision: over.revision ?? op.revision, approval: phone.approve(ORIGIN, over.opId ?? op.operation_id, over.revision ?? op.revision, over.hash ?? termsHash(op.summary, op.terms), { time: over.time, nonce: over.nonce, withAuthKey: over.withAuthKey }) });
const post = (phone: FakePhone, deps: AuthenticatorDeps, path: string, body: string, handler: typeof approve) => handler(phone.request(ORIGIN, "POST", path, body), deps, path.split("/")[3]!);

describe("enrolling", () => {
	it("claims the enrollment with the secret and two public keys, and answers with the code to compare on the website", async () => {
		const { deps } = await setup();
		const phone = new FakePhone("  Pixel   8 ");
		const started = await deps.devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		const res = await enroll(new Request(`${ORIGIN}/authenticator/enroll`, { method: "POST", body: JSON.stringify({ enrollment_id: started.id, secret: started.secret, name: phone.name, auth_key: phone.keys.authKey, approval_key: phone.keys.approvalKey }) }), deps);
		expect(res.status).toBe(201);
		const body = (await res.json()) as { device_id: string; code: string; origin: string; customer: string };
		expect(body).toMatchObject({ origin: ORIGIN, customer: "Ann" });
		expect(body.code).toMatch(/^\d{6}$/);
		expect((await deps.devices.liveOf("cus_a"))).toMatchObject({ id: body.device_id, name: "Pixel 8", status: "waiting", code: body.code });
	});

	it("gives the same answer to a wrong secret, an unknown enrollment, a spent one and an expired one, and refuses bad keys and names", async () => {
		const { deps } = await setup();
		const phone = new FakePhone();
		const send = (over: Record<string, unknown>) => enroll(new Request(`${ORIGIN}/authenticator/enroll`, { method: "POST", body: JSON.stringify({ name: "P", auth_key: phone.keys.authKey, approval_key: phone.keys.approvalKey, ...over }) }), deps);
		const started = await deps.devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		const answers = [await send({ enrollment_id: started.id, secret: "nope" }), await send({ enrollment_id: "enr_x", secret: started.secret })];
		expect((await send({ enrollment_id: started.id, secret: started.secret, name: "" })).status).toBe(400);
		expect((await send({ enrollment_id: started.id, secret: started.secret, name: "x".repeat(41) })).status).toBe(400);
		expect((await send({ enrollment_id: started.id, secret: started.secret, auth_key: { kty: "EC", crv: "P-256", x: "short", y: "short" } })).status).toBe(400);
		expect((await send({ enrollment_id: started.id, secret: started.secret, approval_key: phone.keys.authKey })).status).toBe(400);
		// Too large to read: refused before it can use up the enrollment.
		const padded = JSON.stringify({ enrollment_id: started.id, secret: started.secret, name: "P", auth_key: phone.keys.authKey, approval_key: phone.keys.approvalKey, padding: "x".repeat(10_000) });
		expect((await enroll(new Request(`${ORIGIN}/authenticator/enroll`, { method: "POST", body: padded }), deps)).status).toBe(400);
		expect((await send({ enrollment_id: started.id, secret: started.secret })).status).toBe(201);
		answers.push(await send({ enrollment_id: started.id, secret: started.secret })); // spent
		expect(answers.map((r) => r.status)).toEqual([400, 400, 400]);
		expect(new Set(await Promise.all(answers.map((r) => r.text()))).size).toBe(1);
		expect((await enroll(new Request(`${ORIGIN}/authenticator/enroll`, { method: "POST", body: "not json" }), deps)).status).toBe(400);
	});
});

describe("a signed request", () => {
	it("is accepted from a confirmed device, whichever signature encoding the phone uses", async () => {
		const { deps, add } = await setup();
		add("op_1", "cus_a");
		for (const encoding of ["der", "raw"] as const) {
			const phone = await enrolled(deps, `cus_${encoding}`, encoding);
			add(`op_${encoding}`, `cus_${encoding}`);
			expect((await list(phone.request(ORIGIN, "GET", "/authenticator/operations"), deps)).status).toBe(200);
		}
	});

	it("is refused from a device nobody confirmed, a removed one, an unknown one, and one signing with another phone's key", async () => {
		const { deps, devices } = await setup();
		const phone = await enrolled(deps);
		const get = (p: FakePhone) => list(p.request(ORIGIN, "GET", "/authenticator/operations"), deps);
		expect((await get(phone)).status).toBe(200);
		const stranger = new FakePhone();
		stranger.deviceId = phone.deviceId; // claims to be the phone, signs with its own keys
		expect((await get(stranger)).status).toBe(401);
		stranger.deviceId = "dev_unknown";
		expect((await get(stranger)).status).toBe(401);
		expect((await list(new Request(`${ORIGIN}/authenticator/operations`), deps)).status).toBe(401);
		const waiting = new FakePhone();
		const started = await devices.startEnrollment("cus_w");
		if (!started.ok) throw new Error("not started");
		const claimed = await devices.claimEnrollment(started.id, started.secret, waiting.keys);
		if (!claimed.ok) throw new Error("not claimed");
		waiting.deviceId = claimed.device.id;
		expect((await get(waiting)).status).toBe(401);
		await devices.remove("cus_a", phone.deviceId);
		expect((await get(phone)).status).toBe(401);
	});

	it("works once: a replay, and a copy with another path or method, or signed for another bank, are refused", async () => {
		const { deps, add } = await setup();
		add("op_1", "cus_a");
		const phone = await enrolled(deps);
		const first = phone.request(ORIGIN, "GET", "/authenticator/operations", "", { nonce: "n-1" });
		expect((await list(first, deps)).status).toBe(200);
		const replay = await list(phone.request(ORIGIN, "GET", "/authenticator/operations", "", { nonce: "n-1" }), deps);
		expect(replay.status).toBe(401);
		expect(((await replay.json()) as { error: string }).error).toBe("replayed_request");
		const signed = phone.request(ORIGIN, "GET", "/authenticator/operations/op_1", "", { nonce: "n-2" });
		const moved = new Request(`${ORIGIN}/authenticator/operations/op_2`, { headers: signed.headers });
		expect((await list(moved, deps)).status).toBe(401);
		const posted = new Request(signed.url, { method: "POST", headers: signed.headers });
		expect((await detail(posted, deps, "op_1")).status).toBe(401);
		const signedBody = phone.request(ORIGIN, "POST", "/authenticator/operations/op_1/decline", '{"a":1}', { nonce: "n-3" });
		const tampered = new Request(signedBody.url, { method: "POST", headers: signedBody.headers, body: '{"a":2}' });
		expect((await decline(tampered, deps, "op_1")).status).toBe(401);
		// A phone signs for the bank's own address, so a request it signed for another bank's address is not this bank's.
		expect((await detail(phone.request("https://other-bank.test", "GET", "/authenticator/operations/op_1"), deps, "op_1")).status).toBe(401);
	});

	it("is refused when its time is not close to the bank's, either way", async () => {
		const { deps } = await setup();
		const phone = await enrolled(deps);
		for (const offset of [-(CLOCK_SKEW_MS + 5000), CLOCK_SKEW_MS + 5000]) {
			const res = await list(phone.request(ORIGIN, "GET", "/authenticator/operations", "", { time: Date.now() + offset }), deps);
			expect(res.status).toBe(401);
			expect(((await res.json()) as { error: string }).error).toBe("stale_request");
		}
		expect((await list(phone.request(ORIGIN, "GET", "/authenticator/operations", "", { time: Date.now() - 30_000 }), deps)).status).toBe(200);
	});
});

describe("what the app sees", () => {
	it("lists the customer's open operations with the terms, a hash of them and the agent that asked, and no one else's", async () => {
		const { deps, add } = await setup();
		add("op_mine", "cus_a");
		add("op_done", "cus_a", { state: "succeeded" });
		add("op_theirs", "cus_b");
		const phone = await enrolled(deps);
		const body = (await (await list(phone.request(ORIGIN, "GET", "/authenticator/operations"), deps)).json()) as { operations: { operation_id: string; terms_hash: string; agent: { name: string }; terms: unknown }[] };
		expect(body.operations.map((o) => o.operation_id)).toEqual(["op_mine"]);
		expect(body.operations[0]).toMatchObject({ terms: { amount: "10.00" }, agent: { name: "Claude bridge" }, terms_hash: termsHash("Pay R10,00 to Boland Power", { amount: "10.00" }) });
	});

	it("names an agent the customer has not connected by its address", async () => {
		const { deps, add } = await setup();
		add("op_1", "cus_a", { client_id: "https://rogue.example/c.json" });
		const phone = await enrolled(deps);
		const body = (await (await detail(phone.request(ORIGIN, "GET", "/authenticator/operations/op_1"), deps, "op_1")).json()) as { agent: { name: string } };
		expect(body.agent.name).toBe("rogue.example");
	});

	it("shows an operation of the customer's own and treats another customer's as none", async () => {
		const { deps, add } = await setup();
		add("op_mine", "cus_a");
		add("op_theirs", "cus_b");
		const phone = await enrolled(deps);
		expect((await detail(phone.request(ORIGIN, "GET", "/authenticator/operations/op_mine"), deps, "op_mine")).status).toBe(200);
		expect((await detail(phone.request(ORIGIN, "GET", "/authenticator/operations/op_theirs"), deps, "op_theirs")).status).toBe(404);
	});
});

describe("approving", () => {
	it("performs the operation on the phone's signature over its revision and terms, and keeps the signature", async () => {
		const { deps, add, approved, devices } = await setup();
		const op = add("op_1", "cus_a");
		const phone = await enrolled(deps);
		const body = approvalBody(phone, op);
		const res = await post(phone, deps, "/authenticator/operations/op_1/approve", body, approve);
		expect(res.status).toBe(200);
		expect(approved).toEqual(["op_1"]);
		const [kept] = await devices.approvals("cus_a");
		expect(kept).toMatchObject({ operationId: "op_1", revision: 1, decision: "approved", deviceId: phone.deviceId, termsHash: termsHash(op.summary, op.terms), signature: (JSON.parse(body) as { approval: { signature: string } }).approval.signature });
	});

	it("does not take a signature made with the auth key or another phone's key, or for other terms, another revision or another operation", async () => {
		const { deps, add, approved } = await setup();
		const op = add("op_1", "cus_a");
		add("op_2", "cus_a");
		const phone = await enrolled(deps);
		const tries: [string, string][] = [
			["other terms", approvalBody(phone, op, { hash: termsHash("Pay R9999,00 to Someone", { amount: "9999.00" }) })],
			["another operation", approvalBody(phone, op, { opId: "op_2" })],
			["another revision", JSON.stringify({ revision: 1, approval: phone.approve(ORIGIN, "op_1", 2, termsHash(op.summary, op.terms)) })],
			["the auth key", approvalBody(phone, op, { withAuthKey: true })],
		];
		for (const [label, body] of tries) {
			const res = await post(phone, deps, "/authenticator/operations/op_1/approve", body, approve);
			expect(res.status, label).toBe(403);
			expect(((await res.json()) as { error: string }).error, label).toBe("invalid_approval");
		}
		const other = new FakePhone();
		other.deviceId = phone.deviceId;
		expect((await post(phone, deps, "/authenticator/operations/op_1/approve", approvalBody(other, op), approve)).status).toBe(403);
		expect(approved).toEqual([]);
	});

	it("takes an approval once: the same signed approval sent again is refused", async () => {
		const { deps, add, approved } = await setup();
		const op = add("op_1", "cus_a");
		const phone = await enrolled(deps);
		const body = approvalBody(phone, op, { nonce: "approval-1" });
		expect((await post(phone, deps, "/authenticator/operations/op_1/approve", body, approve)).status).toBe(200);
		op.state = "proposed"; // as if it were open again
		const again = await post(phone, deps, "/authenticator/operations/op_1/approve", body, approve);
		expect(again.status).toBe(403);
		expect(((await again.json()) as { error: string }).error).toBe("replayed_approval");
		expect(approved).toEqual(["op_1"]);
	});

	it("does not take an approval signed at a time far from the bank's", async () => {
		const { deps, add, approved } = await setup();
		const op = add("op_1", "cus_a");
		const phone = await enrolled(deps);
		const res = await post(phone, deps, "/authenticator/operations/op_1/approve", approvalBody(phone, op, { time: Date.now() - CLOCK_SKEW_MS - 5000 }), approve);
		expect(res.status).toBe(401);
		expect(approved).toEqual([]);
	});

	it("answers an operation that is not open, or whose terms changed, with the operation as it is, and approves nothing", async () => {
		const { deps, add, approved } = await setup();
		const done = add("op_done", "cus_a", { state: "succeeded" });
		const changed = add("op_changed", "cus_a", { revision: 2 });
		const phone = await enrolled(deps);
		const late = await post(phone, deps, "/authenticator/operations/op_done/approve", approvalBody(phone, done), approve);
		expect(late.status).toBe(409);
		expect(((await late.json()) as { error: string }).error).toBe("not_open");
		const stale = await post(phone, deps, "/authenticator/operations/op_changed/approve", JSON.stringify({ revision: 1, approval: phone.approve(ORIGIN, "op_changed", 1, termsHash(changed.summary, changed.terms)) }), approve);
		expect(stale.status).toBe(409);
		const body = (await stale.json()) as { error: string; operation: { revision: number } };
		expect(body).toMatchObject({ error: "terms_changed", operation: { revision: 2 } });
		expect(approved).toEqual([]);
	});

	it("refuses another customer's operation and a body without an approval", async () => {
		const { deps, add, approved } = await setup();
		const theirs = add("op_theirs", "cus_b");
		const mine = add("op_mine", "cus_a");
		const phone = await enrolled(deps);
		expect((await post(phone, deps, "/authenticator/operations/op_theirs/approve", approvalBody(phone, theirs), approve)).status).toBe(404);
		expect((await post(phone, deps, "/authenticator/operations/op_mine/approve", JSON.stringify({ revision: mine.revision }), approve)).status).toBe(400);
		expect((await post(phone, deps, "/authenticator/operations/op_mine/approve", "not json", approve)).status).toBe(400);
		expect(approved).toEqual([]);
	});
});

describe("declining", () => {
	it("turns the operation down on the signed request alone, and keeps a record", async () => {
		const { deps, add, ops, devices } = await setup();
		const op = add("op_1", "cus_a");
		const phone = await enrolled(deps);
		const res = await post(phone, deps, "/authenticator/operations/op_1/decline", "{}", decline);
		expect(res.status).toBe(200);
		expect(ops.get("op_1")?.state).toBe("cancelled");
		expect((await devices.approvals("cus_a")).map((a) => [a.operationId, a.decision, a.termsHash])).toEqual([["op_1", "declined", termsHash(op.summary, op.terms)]]);
	});

	it("does not decline another customer's operation, nor record a decision on one that was already decided", async () => {
		const { deps, add, ops, devices } = await setup();
		add("op_theirs", "cus_b");
		add("op_done", "cus_a", { state: "succeeded" });
		const phone = await enrolled(deps);
		expect((await post(phone, deps, "/authenticator/operations/op_theirs/decline", "{}", decline)).status).toBe(404);
		expect(ops.get("op_theirs")?.state).toBe("proposed");
		expect((await post(phone, deps, "/authenticator/operations/op_done/decline", "{}", decline)).status).toBe(200);
		expect(ops.get("op_done")?.state).toBe("succeeded");
		expect(await devices.approvals("cus_a")).toEqual([]);
	});
});

describe("the sign-in code", () => {
	const released = { ok: true as const, origin: "https://da.test", code: "enr_x.y", expiresAt: Date.parse("2026-11-14T12:00:00Z") };
	const ask = (phone: FakePhone, deps: AuthenticatorDeps) => signinCode(phone.request(ORIGIN, "POST", "/authenticator/signin-code", ""), deps);

	it("goes to a confirmed phone, for its own customer", async () => {
		const { deps } = await setup();
		const asked: string[] = [];
		deps.signin = { release: async (owner) => (asked.push(owner), released) };
		const phone = await enrolled(deps, "cus_a");
		const res = await ask(phone, deps);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ origin: "https://da.test", code: "enr_x.y", expires_at: "2026-11-14T12:00:00.000Z" });
		expect(asked).toEqual(["cus_a"]);
	});

	it("is refused to a phone the customer has not confirmed yet, so a QR code alone gets nothing", async () => {
		const { deps, devices } = await setup();
		let released_ = false;
		deps.signin = { release: async () => ((released_ = true), released) };
		const phone = new FakePhone("Pixel");
		const started = await devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("no enrollment");
		const claimed = await enroll(new Request(`${ORIGIN}/authenticator/enroll`, { method: "POST", body: JSON.stringify({ enrollment_id: started.id, secret: started.secret, name: "Pixel", auth_key: phone.keys.authKey, approval_key: phone.keys.approvalKey }) }), deps);
		phone.deviceId = ((await claimed.json()) as { device_id: string }).device_id;
		expect((await ask(phone, deps)).status).toBe(401);
		expect(released_).toBe(false);
	});

	it("is refused to a request that no phone signed", async () => {
		const { deps } = await setup();
		deps.signin = { release: async () => released };
		const res = await signinCode(new Request(`${ORIGIN}/authenticator/signin-code`, { method: "POST", body: "" }), deps);
		expect(res.status).toBe(401);
	});

	it("says so when the bank has no sign-in service, when the customer has the most phones, and when the service is down", async () => {
		const { deps } = await setup();
		const phone = await enrolled(deps);
		expect((await ask(phone, deps)).status).toBe(404);
		deps.signin = { release: async () => ({ ok: false, reason: "limit" }) };
		expect((await ask(phone, deps)).status).toBe(409);
		deps.signin = { release: async () => { throw new PhoneSigninError("down"); } };
		expect((await ask(phone, deps)).status).toBe(503);
	});
});
