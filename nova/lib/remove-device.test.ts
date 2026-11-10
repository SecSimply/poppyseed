import { describe, expect, it } from "vitest";
import { memoryDevices } from "./devices.ts";
import { FakePhone } from "./fake-phone.ts";
import { removeDeviceAs } from "./staff.ts";

describe("removing a customer's phone", () => {
	const staff = { by: "session", id: "aut_1", name: "Sam" } as const;
	const key = { by: "key", id: "aut_support", name: "Protea Bank support" } as const;

	async function enrolled() {
		const devices = memoryDevices();
		const started = await devices.startEnrollment("cus_a");
		if (!started.ok) throw new Error("not started");
		const claimed = await devices.claimEnrollment(started.id, started.secret, new FakePhone().keys);
		if (!claimed.ok) throw new Error("not claimed");
		await devices.confirm("cus_a", claimed.device.id);
		return { devices, id: claimed.device.id };
	}

	it("is done by a staff member signed in with Curity, and not by the emergency key", async () => {
		const { devices, id } = await enrolled();
		expect(await removeDeviceAs(key, devices, id)).toBe(false);
		expect(await devices.hasActive("cus_a")).toBe(true);
		expect(await removeDeviceAs(staff, devices, id)).toBe(true);
		expect(await devices.hasActive("cus_a")).toBe(false);
	});
});
