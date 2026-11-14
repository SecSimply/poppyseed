import { describe, expect, it } from "vitest";
import { MAX_PHONES, PhoneSigninError, phoneSignin, phoneSigninConfig } from "./phone-signin.ts";

const config = { url: "http://device-auth.internal:8080", adminKey: "admin-secret", publicUrl: "https://da.proteabank.co.za" };

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown; signal: unknown }

/** A fake service: answers each call from the list, in order, and records what was asked. */
function service(...answers: (Response | Error)[]) {
	const calls: Call[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined, signal: init.signal });
		const next = answers.shift();
		if (!next) throw new Error("unexpected call");
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;
	return { calls, phone: phoneSignin(config, fetchImpl)! };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const device = (id: string, status = "active") => ({ deviceId: id, label: `Phone ${id}`, status, createdAt: "2026-11-13T12:00:00.0000000+00:00", lastAuthAt: null });
const devices = (...d: ReturnType<typeof device>[]) => json({ devices: d });
const made = { enrolmentId: "enr_abc", code: "enr_abc.secretpart", expiresAt: "2026-11-13T12:10:00.0000000+00:00" };

describe("phone sign-in", () => {
	it("is off unless the service address, the admin key and the public address are all given", () => {
		expect(phoneSigninConfig({ DEVICE_AUTH_URL: "http://x", DEVICE_AUTH_ADMIN_KEY: "k", DEVICE_AUTH_PUBLIC_URL: "https://da.example" })).toEqual({ url: "http://x", adminKey: "k", publicUrl: "https://da.example" });
		expect(phoneSigninConfig({ DEVICE_AUTH_URL: "http://x", DEVICE_AUTH_PUBLIC_URL: "https://da.example" })).toBeUndefined();
		expect(phoneSigninConfig({ DEVICE_AUTH_URL: "http://x", DEVICE_AUTH_ADMIN_KEY: "k" })).toBeUndefined();
		expect(phoneSigninConfig({ DEVICE_AUTH_URL: "not a url", DEVICE_AUTH_ADMIN_KEY: "k", DEVICE_AUTH_PUBLIC_URL: "https://da.example" })).toBeUndefined();
		expect(phoneSignin(undefined)).toBeUndefined();
	});

	it("asks for a code for the customer, with the admin key, and hands back the phone's own address", async () => {
		const { calls, phone } = service(devices(), json(made, 201));
		const released = await phone.release("cust_1");
		expect(released).toEqual({ ok: true, origin: "https://da.proteabank.co.za", code: "enr_abc.secretpart", expiresAt: Date.parse(made.expiresAt) });
		const ask = calls[1]!;
		expect(ask.url).toBe("http://device-auth.internal:8080/v1/admin/enrolments");
		expect(ask.method).toBe("POST");
		expect(ask.body).toEqual({ owner: "cust_1", minutes: 10 });
		expect(ask.headers["x-admin-key"]).toBe("admin-secret");
	});

	it("hands back the address the phone reaches, not the private one", async () => {
		const { phone } = service(devices(), json(made, 201));
		const released = await phone.release("cust_1");
		expect(released.ok && released.origin).toBe(config.publicUrl);
	});

	it("bounds every call in time", async () => {
		const { calls, phone } = service(devices());
		await phone.phones("cust_1");
		expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
	});

	it("does not make a code for a customer who already has the most phones", async () => {
		const { calls, phone } = service(devices(...Array.from({ length: MAX_PHONES }, (_, i) => device(`d${i}`))));
		expect(await phone.release("cust_1")).toEqual({ ok: false, reason: "limit" });
		expect(calls).toHaveLength(1); // it only looked at the phones; no code was made
	});

	it("counts only the phones that can still sign in", async () => {
		const { phone } = service(devices(device("a"), device("b"), device("c", "revoked")), json(made, 201));
		expect((await phone.release("cust_1")).ok).toBe(true);
	});

	it("puts the customer's id in the path, encoded", async () => {
		const { calls, phone } = service(devices());
		await phone.phones("a/b c");
		expect(calls[0]!.url).toBe("http://device-auth.internal:8080/v1/admin/owners/a%2Fb%20c/devices");
	});

	it("sends nothing to the service for something that is not an id", async () => {
		const { calls, phone } = service();
		for (const bad of ["..", ".", "../owners/cus_2/devices", "a/b", "a b", "", "x".repeat(81)]) {
			expect(await phone.remove("cust_1", bad), bad).toBe(false);
		}
		expect(calls).toHaveLength(0);
	});

	it("removes a phone only through its owner, and says whether anything was removed", async () => {
		const { calls, phone } = service(new Response(null, { status: 204 }), json({}, 404), json({}, 500));
		expect(await phone.remove("cust_1", "dev_1")).toBe(true);
		expect(calls[0]!.url).toBe("http://device-auth.internal:8080/v1/admin/owners/cust_1/devices/dev_1/revoke");
		expect(calls[0]!.method).toBe("POST");
		expect(await phone.remove("cust_1", "dev_2")).toBe(false);
		await expect(phone.remove("cust_1", "dev_3")).rejects.toBeInstanceOf(PhoneSigninError);
	});

	it("removes every phone of the customer, and counts them", async () => {
		const { calls, phone } = service(devices(device("a"), device("b"), device("c", "revoked")), new Response(null, { status: 204 }), json({}, 404));
		expect(await phone.removeAll("cust_1")).toBe(1); // "a" went, "b" was already gone, the revoked "c" is not asked about
		expect(calls.map((c) => c.url)).toEqual([
			"http://device-auth.internal:8080/v1/admin/owners/cust_1/devices",
			"http://device-auth.internal:8080/v1/admin/owners/cust_1/devices/a/revoke",
			"http://device-auth.internal:8080/v1/admin/owners/cust_1/devices/b/revoke",
		]);
	});

	it("shows nothing the service did not confirm: an unreachable or confusing service is an error", async () => {
		await expect(service(new Error("connect ECONNREFUSED")).phone.phones("cust_1")).rejects.toBeInstanceOf(PhoneSigninError);
		await expect(service(json({ devices: [{ deviceId: 7 }] })).phone.phones("cust_1")).rejects.toBeInstanceOf(PhoneSigninError);
		await expect(service(json({}, 500)).phone.phones("cust_1")).rejects.toBeInstanceOf(PhoneSigninError);
	});
});
