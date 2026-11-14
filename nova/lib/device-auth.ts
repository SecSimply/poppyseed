/**
 * How the bank knows a request or an approval came from an enrolled phone. Who is in the app is the device auth service's
 * to say: the phone unlocks its sign-in key with the fingerprint, gets a short session from the service, and sends it as a
 * bearer token. The bank asks the service whose session it is, and accepts it only from the service's device that this
 * phone was bound to (the one that registered with the code the bank made for it), so another phone registered for the
 * same customer is not this app. An approval is a different thing: the phone's approval key, unlocked with the fingerprint
 * each time, signs the text built here, so the phone and the bank cannot disagree about what was approved. The signature is ECDSA
 * with SHA-256, base64url, as the 64 bytes r||s or as ASN.1 DER (what Android produces). The format is written down in AUTHENTICATOR.md.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Device, Devices, PublicJwk } from "./devices.ts";
import { PhoneSigninError, type PhoneSignin } from "./phone-signin.ts";

/** A request's time may differ from the bank's by this much. */
export const CLOCK_SKEW_MS = 120_000;
/** A nonce is remembered for twice that, so a request cannot be replayed while it is still fresh. */
export const NONCE_MS = 2 * CLOCK_SKEW_MS + 60_000;

export class DeviceAuthError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

/** JSON with every object's keys in order and no spaces: the same value is always the same text. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

const b64 = (data: string | Buffer): string => createHash("sha256").update(data).digest("base64url");

/** What an approval covers: the words the customer reads and the terms behind them. */
export const termsHash = (summary: string, terms: Record<string, unknown>): string => b64(canonicalJson({ summary, terms }));

/** The text the approval key signs to ask for the sign-in code, once, after the customer confirmed the phone. */
export const signinCodeMessage = (a: { origin: string; deviceId: string; nonce: string; time: string }): string =>
	["PROTEA-SIGNIN-CODE-V1", a.origin, a.deviceId, a.nonce, a.time].join("\n");

export const approvalMessage = (a: { origin: string; deviceId: string; operationId: string; revision: number; termsHash: string; nonce: string; time: string }): string =>
	["PROTEA-APPROVE-V1", a.origin, a.deviceId, a.operationId, String(a.revision), a.termsHash, a.nonce, a.time].join("\n");

const COORDINATE = /^[A-Za-z0-9_-]{43}$/;

/** A public key the phone sent, if it is a P-256 key the bank can verify with. */
export function parsePublicJwk(input: unknown): PublicJwk | undefined {
	const k = input as Partial<PublicJwk> | null;
	if (!k || typeof k !== "object" || k.kty !== "EC" || k.crv !== "P-256" || typeof k.x !== "string" || typeof k.y !== "string") return undefined;
	if (!COORDINATE.test(k.x) || !COORDINATE.test(k.y)) return undefined;
	const jwk: PublicJwk = { kty: "EC", crv: "P-256", x: k.x, y: k.y };
	try {
		createPublicKey({ key: jwk, format: "jwk" });
	} catch {
		return undefined;
	}
	return jwk;
}

/** Whether `signature` is the key's ECDSA P-256 SHA-256 signature of `message`. */
export function verifyEs256(jwk: PublicJwk, message: string, signature: string): boolean {
	try {
		const raw = Buffer.from(signature, "base64url");
		const key = createPublicKey({ key: jwk, format: "jwk" });
		return verify("sha256", Buffer.from(message), { key, dsaEncoding: raw.length === 64 ? "ieee-p1363" : "der" }, raw);
	} catch {
		return false;
	}
}

/** The time as the phone wrote it: whole milliseconds since 1970, and close to the bank's own. */
function checkTime(time: string, now: number): void {
	if (!/^\d{10,16}$/.test(time) || Math.abs(Number(time) - now) > CLOCK_SKEW_MS) throw new DeviceAuthError(401, "stale_request", "the request's time is not close to the bank's: check the phone's clock");
}

/**
 * Whose app this is: the active device of the customer whose session the service vouches for, if the session is of the
 * service's device this phone is bound to. The first session after the phone registered binds it: the bank asks the
 * service which device registered with the code it made, and that must be this session's device.
 */
export async function authenticate(request: Request, devices: Devices, signin: Pick<PhoneSignin, "whoami" | "enrolmentOf">): Promise<Device> {
	const fail = () => new DeviceAuthError(401, "invalid_device_request", "the request does not carry a sign-in of an enrolled phone");
	const header = request.headers.get("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice(7) : "";
	if (!token) throw fail();
	try {
		const who = await signin.whoami(token);
		if (!who) throw fail();
		const device = await devices.liveOf(who.owner);
		if (!device || device.status !== "active") throw fail();
		if (device.signinDeviceId === undefined) {
			const code = device.signinEnrolmentId ? await signin.enrolmentOf(device.signinEnrolmentId) : undefined;
			if (code?.deviceId !== who.deviceId) throw fail(); // only a code that was used has a device
			await devices.bindSignin(device.id, who.deviceId);
		} else if (device.signinDeviceId !== who.deviceId) throw fail();
		await devices.touch(device.id);
		return device;
	} catch (error) {
		if (error instanceof PhoneSigninError) throw new DeviceAuthError(503, "signin_unavailable", "the sign-in service is not available right now: try again in a few minutes");
		throw error;
	}
}

/** The request for the sign-in code: the phone's approval key signed it, for this bank and this device, once. */
export async function checkSigninCodeRequest(
	device: Device,
	request: { nonce: string; time: string; signature: string },
	devices: Devices,
	origin: string,
	now: number = Date.now(),
): Promise<void> {
	const invalid = () => new DeviceAuthError(401, "invalid_device_request", "the request is not signed by this phone's approval key");
	if (!request.nonce || request.nonce.length > 100 || !request.signature || request.signature.length > 200) throw invalid();
	checkTime(request.time, now);
	if (!verifyEs256(device.approvalKey, signinCodeMessage({ origin, deviceId: device.id, nonce: request.nonce, time: request.time }), request.signature)) throw invalid();
	if (!(await devices.claimNonce(device.id, `c:${request.nonce}`, NONCE_MS))) throw new DeviceAuthError(401, "replayed_request", "this request was already used");
}

/** An approval's signature, from the device's approval key over exactly this operation, revision and terms, once. */
export async function checkApproval(
	device: Device,
	signed: { operationId: string; revision: number; termsHash: string },
	approval: { signature: string; nonce: string; time: string },
	devices: Devices,
	origin: string,
	now: number = Date.now(),
): Promise<void> {
	const invalid = () => new DeviceAuthError(403, "invalid_approval", "the approval was not signed by this device's approval key for this operation");
	if (!approval.nonce || approval.nonce.length > 100 || !approval.signature || approval.signature.length > 200) throw invalid();
	checkTime(approval.time, now);
	if (!verifyEs256(device.approvalKey, approvalMessage({ origin, deviceId: device.id, ...signed, nonce: approval.nonce, time: approval.time }), approval.signature)) throw invalid();
	if (!(await devices.claimNonce(device.id, `a:${approval.nonce}`, NONCE_MS))) throw new DeviceAuthError(403, "replayed_approval", "this approval was already used");
}
