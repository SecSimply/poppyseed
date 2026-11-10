/**
 * Approving from the website. A customer with a phone enrolled approves on the phone only: the website, which a stolen
 * browser session would reach, no longer can. Without a phone, the approval page works as it always did.
 */
import type { Devices } from "./devices.ts";

export async function approveFromWebsite<T>(customerId: string, devices: Pick<Devices, "hasActive">, approve: () => Promise<T>): Promise<{ ok: true; operation: T } | { ok: false; reason: "phone_required" }> {
	if (await devices.hasActive(customerId)) return { ok: false, reason: "phone_required" };
	return { ok: true, operation: await approve() };
}
