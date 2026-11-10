/**
 * Confirming a waiting device. What agents had already proposed was proposed before the phone, under the old rules, so an agent
 * could still confirm it on a standing permission: those are turned down, and the agent proposes them again, to the phone.
 */
import type { OperationsApi } from "./authenticator.ts";
import type { Devices } from "./devices.ts";

export async function activateDevice(customerId: string, deviceId: string, devices: Pick<Devices, "confirm">, operations: Pick<OperationsApi, "pending" | "decline">): Promise<boolean> {
	if (!(await devices.confirm(customerId, deviceId))) return false;
	for (const op of await operations.pending(customerId)) await operations.decline(op.operation_id, customerId);
	return true;
}
