/**
 * How the bank knows a request or an approval came from an enrolled phone. The phone holds two P-256 keys in its secure
 * hardware. The auth key signs every request (no fingerprint, so the app can look for waiting approvals); the approval key
 * signs an approval, and the phone unlocks it with the fingerprint each time. Both signatures are ECDSA with SHA-256,
 * base64url, either as the 64 bytes r||s or as ASN.1 DER (what Android produces). The text each signs is built here, line by
 * line, so the phone and the bank cannot disagree about what was signed. The format is written down in AUTHENTICATOR.md.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Device, Devices, PublicJwk } from "./devices.ts";

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
export const bodyHash = (body: string): string => b64(body);

export const requestMessage = (r: { method: string; host: string; target: string; time: string; nonce: string; body: string }): string =>
	["PROTEA-DEVICE-V1", r.method.toUpperCase(), r.host, r.target, r.time, r.nonce, bodyHash(r.body)].join("\n");

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

const header = (request: Request, name: string): string => request.headers.get(name) ?? "";

/** The time as the phone wrote it: whole milliseconds since 1970, and close to the bank's own. */
function checkTime(time: string, now: number): void {
	if (!/^\d{10,16}$/.test(time) || Math.abs(Number(time) - now) > CLOCK_SKEW_MS) throw new DeviceAuthError(401, "stale_request", "the request's time is not close to the bank's: check the phone's clock");
}

/**
 * Who sent this request: an active device whose auth key signed it, once. The signature is checked before the nonce is
 * taken, so a request with a bad signature uses up nothing.
 */
export async function authenticate(request: Request, body: string, devices: Devices, host: string, now: number = Date.now()): Promise<Device> {
	const id = header(request, "x-device-id"), time = header(request, "x-device-time"), nonce = header(request, "x-device-nonce"), signature = header(request, "x-device-signature");
	const fail = () => new DeviceAuthError(401, "invalid_device_request", "the request is not signed by an enrolled device");
	if (!id || !nonce || !signature || nonce.length > 100 || signature.length > 200) throw fail();
	checkTime(time, now);
	const device = await devices.active(id);
	if (!device) throw fail();
	const url = new URL(request.url);
	if (!verifyEs256(device.authKey, requestMessage({ method: request.method, host, target: url.pathname + url.search, time, nonce, body }), signature)) throw fail();
	if (!(await devices.claimNonce(device.id, `r:${nonce}`, NONCE_MS))) throw new DeviceAuthError(401, "replayed_request", "this request was already used");
	await devices.touch(device.id);
	return device;
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
