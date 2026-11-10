/**
 * A Cookie header that signs a demo customer in to a local Protea Bank, for the development scripts that play the
 * customer. It seals a session with the same secret the local server was started with (POPPYSEED_SECRET; by default
 * the one the scripts here start servers with). It cannot sign anyone in to a deployed site, whose secret is not known.
 *
 *   node --experimental-strip-types --no-warnings scripts/person.ts [cus_thandi|cus_pieter]
 */
process.env.POPPYSEED_SECRET ??= "local-secret-local-secret-local-secret-1";
process.env.POPPYSEED_BASE_URL ??= "http://localhost:3400";

const { customerById } = await import("../lib/customers.ts");
const { SESSION_COOKIE, sealSession } = await import("../lib/session.ts");

/** `name=value` for the Cookie header of a browser that has signed in as this customer. */
export async function personCookie(id = "cus_thandi"): Promise<string> {
	const customer = await customerById(id);
	if (!customer) throw new Error(`no customer ${id}`);
	return `${SESSION_COOKIE}=${sealSession({ sub: `demo:${id}`, email: customer.email, name: customer.name, customerId: id, staff: false })}`;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await personCookie(process.argv[2]));
