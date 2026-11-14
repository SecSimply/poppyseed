/**
 * What the Protea app asks of the bank. Every route but `enroll` is signed by an enrolled phone (see device-auth.ts), and
 * shows or changes only that phone's customer's operations. The bank's own approval page is not used for these: an
 * approval here is a signature the phone made with its approval key, after the fingerprint, over exactly the revision and
 * terms the customer saw. The signature, not the request, is what approves; the routes in app/authenticator/ only pass requests in.
 */
import { authenticate, checkApproval, DeviceAuthError, parsePublicJwk, termsHash } from "./device-auth.ts";
import type { Device, Devices } from "./devices.ts";
import { PhoneSigninError, type PhoneSignin } from "./phone-signin.ts";

/** The part of the Poppy instance these routes use. */
export interface OperationsApi {
	get(operationId: string, accountId?: string): Promise<HostOperation | undefined>;
	pending(accountId: string): Promise<HostOperation[]>;
	approve(operationId: string, accountId: string, revision: number): Promise<HostOperation>;
	decline(operationId: string, accountId: string): Promise<HostOperation>;
}

export interface HostOperation {
	operation_id: string;
	revision: number;
	state: string;
	summary: string;
	terms: Record<string, unknown>;
	expires_at?: string;
	client_id: string;
	result: { summary: string } | null;
}

export interface AuthenticatorDeps {
	devices: Devices;
	operations: OperationsApi;
	/** The customers' connected agents, to name the one that asked. */
	agents(customerId: string): Promise<{ clientId: string; clientName?: string }[]>;
	customerName(customerId: string): Promise<string | undefined>;
	/** The bank's public address, which the phone's signatures are bound to. */
	origin: string;
	/** The device auth service, when the bank has one: the phone's sign-in registration. */
	signin?: Pick<PhoneSignin, "release">;
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const problem = (status: number, error: string, message: string): Response => json({ error, message }, status);

async function guarded(request: Request, deps: AuthenticatorDeps, run: (device: Device, body: string) => Promise<Response>): Promise<Response> {
	try {
		const body = request.method === "GET" ? "" : await request.text();
		if (body.length > 10_000) return problem(413, "too_large", "the request is too large");
		return await run(await authenticate(request, body, deps.devices, new URL(deps.origin).host), body);
	} catch (error) {
		if (error instanceof DeviceAuthError) return problem(error.status, error.code, error.message);
		throw error;
	}
}

/** What the phone shows for one operation, built only from what the bank holds. */
async function view(op: HostOperation, deps: AuthenticatorDeps, customerId: string) {
	const agent = (await deps.agents(customerId)).find((a) => a.clientId === op.client_id);
	return {
		operation_id: op.operation_id,
		revision: op.revision,
		state: op.state,
		summary: op.summary,
		terms: op.terms,
		terms_hash: termsHash(op.summary, op.terms),
		...(op.expires_at ? { expires_at: op.expires_at } : {}),
		agent: { client_id: op.client_id, name: agent?.clientName ?? new URL(op.client_id).host },
		...(op.result ? { result: op.result.summary } : {}),
	};
}

/** POST /authenticator/enroll: the app claims an enrollment with the secret from the QR code and the two public keys it made. */
export async function enroll(request: Request, deps: AuthenticatorDeps): Promise<Response> {
	const text = await request.text();
	const body = (text.length > 10_000 ? null : (() => { try { return JSON.parse(text); } catch { return null; } })()) as Record<string, unknown> | null;
	const invalid = problem(400, "invalid_enrollment", "the enrollment is not valid: scan a new QR code");
	if (!body || typeof body.enrollment_id !== "string" || typeof body.secret !== "string") return invalid;
	const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
	const authKey = parsePublicJwk(body.auth_key), approvalKey = parsePublicJwk(body.approval_key);
	if (name.length < 1 || name.length > 40 || !authKey || !approvalKey) return problem(400, "invalid_request", "send a name of 1 to 40 characters and the two P-256 public keys as JWKs");
	if (authKey.x === approvalKey.x && authKey.y === approvalKey.y) return problem(400, "invalid_request", "the auth key and the approval key must be different keys");
	const claimed = await deps.devices.claimEnrollment(body.enrollment_id, body.secret, { name, authKey, approvalKey });
	if (!claimed.ok) return invalid;
	// The code is for the customer to compare on the website; the phone shows it too.
	return json({ device_id: claimed.device.id, code: claimed.device.code, origin: deps.origin, customer: (await deps.customerName(claimed.device.customerId)) ?? null }, 201);
}

/** GET /authenticator/operations: what is waiting for this phone's customer. */
export const list = (request: Request, deps: AuthenticatorDeps): Promise<Response> =>
	guarded(request, deps, async (device) => json({ operations: await Promise.all((await deps.operations.pending(device.customerId)).map((op) => view(op, deps, device.customerId))) }));

/** GET /authenticator/operations/{id}. Another customer's operation is the same as none. */
export const detail = (request: Request, deps: AuthenticatorDeps, id: string): Promise<Response> =>
	guarded(request, deps, async (device) => {
		const op = await deps.operations.get(id, device.customerId);
		return op ? json(await view(op, deps, device.customerId)) : problem(404, "operation_not_found", "no such operation");
	});

/** POST /authenticator/operations/{id}/approve with {"revision", "approval": {"signature", "nonce", "time"}}. */
export const approve = (request: Request, deps: AuthenticatorDeps, id: string): Promise<Response> =>
	guarded(request, deps, async (device, text) => {
		const body = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })();
		const approval = body?.approval as Record<string, unknown> | undefined;
		if (!body || !Number.isInteger(body.revision) || typeof approval?.signature !== "string" || typeof approval.nonce !== "string" || typeof approval.time !== "string") {
			return problem(400, "invalid_request", 'send {"revision": number, "approval": {"signature", "nonce", "time"}}');
		}
		const op = await deps.operations.get(id, device.customerId);
		if (!op) return problem(404, "operation_not_found", "no such operation");
		if (op.state !== "proposed") return json({ error: "not_open", message: "this operation was already decided or has expired", operation: await view(op, deps, device.customerId) }, 409);
		if (body.revision !== op.revision) return json({ error: "terms_changed", message: `revision ${op.revision} is the latest`, operation: await view(op, deps, device.customerId) }, 409);
		const hash = termsHash(op.summary, op.terms);
		const signed = { operationId: id, revision: op.revision, termsHash: hash };
		await checkApproval(device, signed, { signature: approval.signature, nonce: approval.nonce, time: approval.time }, deps.devices, deps.origin);
		const done = await deps.operations.approve(id, device.customerId, op.revision);
		await deps.devices.record({ operationId: id, revision: op.revision, deviceId: device.id, customerId: device.customerId, decision: "approved", termsHash: hash, signature: approval.signature });
		return json({ operation: await view(done, deps, device.customerId) });
	});

/** POST /authenticator/operations/{id}/decline. Turning a payment down needs no fingerprint: the signed request is enough. */
export const decline = (request: Request, deps: AuthenticatorDeps, id: string): Promise<Response> =>
	guarded(request, deps, async (device) => {
		const op = await deps.operations.get(id, device.customerId);
		if (!op) return problem(404, "operation_not_found", "no such operation");
		const done = await deps.operations.decline(id, device.customerId);
		if (op.state === "proposed" && done.state === "cancelled") {
			await deps.devices.record({ operationId: id, revision: op.revision, deviceId: device.id, customerId: device.customerId, decision: "declined", termsHash: termsHash(op.summary, op.terms), signature: "" });
		}
		return json({ operation: await view(done, deps, device.customerId) });
	});

/**
 * POST /authenticator/signin-code: the phone asks for the one-time code that registers it with the device auth service, so the
 * one phone the customer added also signs them in. Only a confirmed phone, by its signed request, gets one (a waiting phone
 * is refused as any other request is), so the code never travels in the QR code and is worth nothing to someone who only saw that.
 */
export const signinCode = (request: Request, deps: AuthenticatorDeps): Promise<Response> =>
	guarded(request, deps, async (device) => {
		if (!deps.signin) return problem(404, "signin_off", "this bank does not sign customers in with a phone");
		try {
			const released = await deps.signin.release(device.customerId);
			if (!released.ok) return problem(409, "too_many_phones", "the customer already has the most phones registered for signing in");
			return json({ origin: released.origin, code: released.code, expires_at: new Date(released.expiresAt).toISOString() });
		} catch (error) {
			if (!(error instanceof PhoneSigninError)) throw error;
			return problem(503, "signin_unavailable", "the sign-in service is not available right now: try again in a few minutes");
		}
	});
