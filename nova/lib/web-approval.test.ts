import { expect, it } from "vitest";
import { memoryDevices } from "./devices.ts";
import { FakePhone } from "./fake-phone.ts";
import { approveFromWebsite } from "./web-approval.ts";

it("approves from the website for a customer with no phone, and not for one with a phone", async () => {
	const devices = memoryDevices();
	let approved = 0;
	const approve = async () => ++approved;
	expect(await approveFromWebsite("cus_a", devices, approve)).toEqual({ ok: true, operation: 1 });
	const started = await devices.startEnrollment("cus_a");
	if (!started.ok) throw new Error("not started");
	const claimed = await devices.claimEnrollment(started.id, started.secret, new FakePhone().keys);
	if (!claimed.ok) throw new Error("not claimed");
	// A phone that is still waiting for the customer to confirm it does not take the website's approval away.
	expect(await approveFromWebsite("cus_a", devices, approve)).toEqual({ ok: true, operation: 2 });
	await devices.confirm("cus_a", claimed.device.id);
	expect(await approveFromWebsite("cus_a", devices, approve)).toEqual({ ok: false, reason: "phone_required" });
	expect(await approveFromWebsite("cus_b", devices, approve)).toEqual({ ok: true, operation: 3 });
	expect(approved).toBe(3);
});
