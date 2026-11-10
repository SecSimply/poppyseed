import { expect, it } from "vitest";
import { activateDevice } from "./enrollment.ts";
import { memoryDevices } from "./devices.ts";
import { FakePhone } from "./fake-phone.ts";

async function waiting() {
	const devices = memoryDevices();
	const started = await devices.startEnrollment("cus_a");
	if (!started.ok) throw new Error("not started");
	const claimed = await devices.claimEnrollment(started.id, started.secret, new FakePhone().keys);
	if (!claimed.ok) throw new Error("not claimed");
	const declined: string[] = [];
	const operations = {
		async pending(customerId: string) {
			return customerId === "cus_a" ? [{ operation_id: "op_1" }, { operation_id: "op_2" }] as never : [];
		},
		async decline(operationId: string, customerId: string) {
			declined.push(`${customerId}:${operationId}`);
			return {} as never;
		},
	};
	return { devices, id: claimed.device.id, operations, declined };
}

it("turns down what agents proposed before the phone when the customer confirms it", async () => {
	const { devices, id, operations, declined } = await waiting();
	expect(await activateDevice("cus_a", id, devices, operations)).toBe(true);
	expect(await devices.hasActive("cus_a")).toBe(true);
	expect(declined).toEqual(["cus_a:op_1", "cus_a:op_2"]);
});

it("turns nothing down when the device is not confirmed", async () => {
	const { devices, id, operations, declined } = await waiting();
	expect(await activateDevice("cus_b", id, devices, operations)).toBe(false);
	expect(await devices.hasActive("cus_a")).toBe(false);
	expect(declined).toEqual([]);
});
