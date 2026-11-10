/** One contract, run against both stores. Postgres runs on PGlite; time is a fake clock in memory and aged rows in Postgres. */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { CONFIRM_MS, ENROLLMENT_MS, memoryDevices, postgresDevices, type Devices, type NewDevice, type PublicJwk } from "./devices.ts";

const key = (n: string): PublicJwk => ({ kty: "EC", crv: "P-256", x: `x-${n}`, y: `y-${n}` });
const phone = (name = "Pixel 8"): NewDevice => ({ name, authKey: key("auth"), approvalKey: key("approve") });

interface Setup {
	devices: Devices;
	/** Moves time past the enrollment window. */
	enrollmentsExpire(): Promise<void>;
	/** Moves time past the time a device may wait to be confirmed. */
	waitingExpires(): Promise<void>;
}

const shared = (async () => { const db = new PGlite(); await db.waitReady; return db; })();
const stores: [string, () => Promise<Setup>][] = [
	["memory", async () => {
		let at = Date.now();
		return { devices: memoryDevices(() => at), enrollmentsExpire: async () => void (at += ENROLLMENT_MS + 1), waitingExpires: async () => void (at += CONFIRM_MS + 1) };
	}],
	["postgres", async () => {
		const db = await shared;
		await db.exec("drop table if exists nova_approvals, nova_device_nonces, nova_devices, nova_device_enrollments cascade");
		const devices = postgresDevices(db);
		await devices.hasActive("warm-up"); // creates the tables
		return {
			devices,
			enrollmentsExpire: async () => void (await db.exec("update nova_device_enrollments set expires_at = now() - interval '1 minute'")),
			waitingExpires: async () => void (await db.exec("update nova_devices set waits_until = now() - interval '1 minute'")),
		};
	}],
];

/** Enrolls and confirms a phone for a customer. */
async function enrolled(devices: Devices, customerId = "cus_a") {
	const started = await devices.startEnrollment(customerId);
	if (!started.ok) throw new Error(started.reason);
	const claimed = await devices.claimEnrollment(started.id, started.secret, phone());
	if (!claimed.ok) throw new Error(claimed.reason);
	expect(await devices.confirm(customerId, claimed.device.id)).toBe(true);
	return claimed.device;
}

describe.each(stores)("%s devices", (_name, make) => {
	it("enrolls a phone: the app claims the QR code's secret, the customer confirms the code, and only then it is active", async () => {
		const { devices } = await make();
		const started = await devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		const claimed = await devices.claimEnrollment(started.id, started.secret, phone("Pixel 8"));
		if (!claimed.ok) throw new Error(claimed.reason);
		expect(claimed.device).toMatchObject({ customerId: "cus_a", name: "Pixel 8", status: "waiting" });
		expect(claimed.device.code).toMatch(/^\d{6}$/);
		expect(await devices.hasActive("cus_a")).toBe(false);
		expect(await devices.active(claimed.device.id)).toBeUndefined();
		expect((await devices.liveOf("cus_a"))?.id).toBe(claimed.device.id);
		expect(await devices.confirm("cus_a", claimed.device.id)).toBe(true);
		expect(await devices.hasActive("cus_a")).toBe(true);
		expect(await devices.active(claimed.device.id)).toMatchObject({ authKey: key("auth"), approvalKey: key("approve") });
	});

	it("takes an enrollment's secret once, and a wrong secret neither enrolls nor spends it", async () => {
		const { devices } = await make();
		const started = await devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		expect(await devices.claimEnrollment(started.id, "not-the-secret", phone())).toEqual({ ok: false, reason: "unknown" });
		expect(await devices.claimEnrollment("enr_unknown", started.secret, phone())).toEqual({ ok: false, reason: "unknown" });
		expect((await devices.claimEnrollment(started.id, started.secret, phone())).ok).toBe(true);
		expect(await devices.claimEnrollment(started.id, started.secret, phone())).toEqual({ ok: false, reason: "used" });
	});

	it("gives a customer one live device: a second enrollment waits until it is removed", async () => {
		const { devices } = await make();
		const first = await enrolled(devices);
		expect(await devices.startEnrollment("cus_a")).toEqual({ ok: false, reason: "has_device" });
		expect((await devices.startEnrollment("cus_b")).ok).toBe(true);
		expect(await devices.remove("cus_a", first.id)).toBe(true);
		expect((await devices.startEnrollment("cus_a")).ok).toBe(true);
	});

	it("does not let an enrollment opened earlier add a second device", async () => {
		const { devices } = await make();
		const early = await devices.startEnrollment("cus_a");
		if (!early.ok) throw new Error("not started");
		const late = await devices.startEnrollment("cus_a"); // still allowed: nothing is live yet
		if (!late.ok) throw new Error("not started");
		expect((await devices.claimEnrollment(early.id, early.secret, phone("one"))).ok).toBe(true);
		expect(await devices.claimEnrollment(late.id, late.secret, phone("two"))).toEqual({ ok: false, reason: "has_device" });
		expect((await devices.all()).map((d) => d.name)).toEqual(["one"]);
	});

	it("refuses an enrollment that was not claimed in time", async () => {
		const { devices, enrollmentsExpire } = await make();
		const started = await devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		await enrollmentsExpire();
		expect(await devices.claimEnrollment(started.id, started.secret, phone())).toEqual({ ok: false, reason: "expired" });
	});

	it("frees the place of a device the customer never confirmed, and cannot confirm it late", async () => {
		const { devices, waitingExpires } = await make();
		const started = await devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		const claimed = await devices.claimEnrollment(started.id, started.secret, phone());
		if (!claimed.ok) throw new Error(claimed.reason);
		await waitingExpires();
		expect(await devices.confirm("cus_a", claimed.device.id)).toBe(false);
		expect(await devices.liveOf("cus_a")).toBeUndefined();
		expect(await devices.hasActive("cus_a")).toBe(false);
		expect((await devices.startEnrollment("cus_a")).ok).toBe(true);
	});

	it("lets only the customer's own session confirm or remove their device", async () => {
		const { devices } = await make();
		const started = await devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		const claimed = await devices.claimEnrollment(started.id, started.secret, phone());
		if (!claimed.ok) throw new Error(claimed.reason);
		expect(await devices.confirm("cus_b", claimed.device.id)).toBe(false);
		expect(await devices.remove("cus_b", claimed.device.id)).toBe(false);
		expect(await devices.confirm("cus_a", claimed.device.id)).toBe(true);
		expect(await devices.confirm("cus_a", claimed.device.id)).toBe(false);
		expect(await devices.remove("cus_b", claimed.device.id)).toBe(false);
		expect(await devices.hasActive("cus_a")).toBe(true);
	});

	it("stops accepting a removed device", async () => {
		const { devices } = await make();
		const device = await enrolled(devices);
		expect(await devices.remove("cus_a", device.id)).toBe(true);
		expect(await devices.active(device.id)).toBeUndefined();
		expect(await devices.hasActive("cus_a")).toBe(false);
		expect(await devices.all()).toEqual([]);
	});

	it("accepts a nonce once per device", async () => {
		const { devices } = await make();
		expect(await devices.claimNonce("dev_1", "n1", 60_000)).toBe(true);
		expect(await devices.claimNonce("dev_1", "n1", 60_000)).toBe(false);
		expect(await devices.claimNonce("dev_2", "n1", 60_000)).toBe(true);
		expect(await devices.claimNonce("dev_1", "n2", 60_000)).toBe(true);
	});

	it("takes the same nonce once when two requests carry it at the same moment", async () => {
		const { devices } = await make();
		const results = await Promise.all([devices.claimNonce("dev_1", "race", 60_000), devices.claimNonce("dev_1", "race", 60_000)]);
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it("remembers when a device was last seen", async () => {
		const { devices } = await make();
		const device = await enrolled(devices);
		expect((await devices.active(device.id))?.lastSeenAt).toBeUndefined();
		await devices.touch(device.id);
		expect((await devices.active(device.id))?.lastSeenAt).toBeDefined();
	});

	it("keeps each decision, newest first, for the customer it belongs to", async () => {
		const { devices } = await make();
		const device = await enrolled(devices);
		await devices.record({ operationId: "op_1", revision: 1, deviceId: device.id, customerId: "cus_a", decision: "approved", termsHash: "h1", signature: "s1" });
		await devices.record({ operationId: "op_2", revision: 2, deviceId: device.id, customerId: "cus_a", decision: "declined", termsHash: "", signature: "" });
		await devices.record({ operationId: "op_3", revision: 1, deviceId: "dev_other", customerId: "cus_b", decision: "approved", termsHash: "h3", signature: "s3" });
		expect((await devices.approvals("cus_a")).map((a) => [a.operationId, a.decision])).toEqual([["op_2", "declined"], ["op_1", "approved"]]);
		expect((await devices.approvals("cus_b")).map((a) => a.operationId)).toEqual(["op_3"]);
	});
});
