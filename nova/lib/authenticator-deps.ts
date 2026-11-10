import { poppyseed } from "../poppyseed.config";
import type { AuthenticatorDeps } from "./authenticator.ts";
import { bank } from "./bank.ts";
import { devices } from "./devices.ts";
import { baseUrl } from "./env.ts";

/** What the app's routes use, from the bank as it runs. */
export async function authenticatorDeps(): Promise<AuthenticatorDeps> {
	return {
		devices: await devices(),
		operations: poppyseed.operations,
		origin: baseUrl,
		agents: async (customerId) => (await poppyseed.connections.list(customerId)).map((c) => ({ clientId: c.clientId, clientName: c.clientName })),
		customerName: async (customerId) => (await (await bank()).customer(customerId))?.name,
	};
}
