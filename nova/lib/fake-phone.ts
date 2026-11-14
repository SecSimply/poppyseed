/**
 * A phone and the device auth service, for tests. The phone has the approval key, which signs the way the Android app does
 * (the real app unlocks it with the fingerprint), and a device at the service, whose session it sends as a bearer token. The
 * service is a stand-in too: it keeps the codes the bank made, the devices registered with them and the sessions it issued.
 */
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { approvalMessage, signinCodeMessage } from "./device-auth.ts";
import type { NewDevice, PublicJwk } from "./devices.ts";
import { PhoneSigninError, type CodeState, type PhoneSignin, type Released, type Who } from "./phone-signin.ts";

/** What the bank uses of the device auth service. */
export type Signin = Pick<PhoneSignin, "release" | "whoami" | "enrolmentOf">;

export class FakeSignin implements Signin {
	readonly origin = "https://da.test";
	/** Set to make the service unreachable. */
	down = false;
	/** How many phones a customer may have registered. */
	max = 3;
	private count = 0;
	private codes = new Map<string, CodeState & { code: string }>();
	private devices = new Map<string, { owner: string; active: boolean }>();
	private sessions = new Map<string, Who>();

	async release(owner: string): Promise<Released> {
		if (this.down) throw new PhoneSigninError("down");
		if ([...this.devices.values()].filter((d) => d.owner === owner && d.active).length >= this.max) return { ok: false, reason: "limit" };
		const enrolmentId = `enr_${++this.count}`, code = `${enrolmentId}.secret`;
		this.codes.set(enrolmentId, { state: "pending", owner, code });
		return { ok: true, origin: this.origin, code, enrolmentId, expiresAt: Date.now() + 600_000 };
	}

	async whoami(token: string): Promise<Who | undefined> {
		if (this.down) throw new PhoneSigninError("down");
		const who = this.sessions.get(token);
		return who && this.devices.get(who.deviceId)?.active ? who : undefined;
	}

	async enrolmentOf(enrolmentId: string): Promise<CodeState | undefined> {
		if (this.down) throw new PhoneSigninError("down");
		const c = this.codes.get(enrolmentId);
		return c && { state: c.state, owner: c.owner, ...(c.deviceId ? { deviceId: c.deviceId } : {}) };
	}

	/** The phone registers at the service with a code, once. Returns the customer it was registered for. */
	register(code: string, deviceId: string): string | undefined {
		const entry = [...this.codes.values()].find((c) => c.code === code);
		if (!entry || entry.state !== "pending") return undefined;
		entry.state = "used";
		entry.deviceId = deviceId;
		this.devices.set(deviceId, { owner: entry.owner, active: true });
		return entry.owner;
	}

	/** The phone unlocks and signs in at the service: a session token for its device. */
	login(deviceId: string): string {
		const device = this.devices.get(deviceId);
		if (!device?.active) throw new Error("the service does not know this device");
		const token = `tok_${randomBytes(12).toString("base64url")}`;
		this.sessions.set(token, { deviceId, owner: device.owner });
		return token;
	}

	/** A device registered for a customer without the bank's knowledge of it: another phone of theirs. */
	registerOther(owner: string, deviceId: string): void {
		this.devices.set(deviceId, { owner, active: true });
	}

	revoke(deviceId: string): void {
		const device = this.devices.get(deviceId);
		if (device) device.active = false;
	}
}

const pair = (): { publicJwk: PublicJwk; privateKey: KeyObject } => {
	const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
	return { publicJwk: publicKey.export({ format: "jwk" }) as PublicJwk, privateKey };
};

export class FakePhone {
	readonly name: string;
	/** The bank's id for this phone. */
	deviceId = "";
	/** The device auth service's id for it, once it registered there. */
	signinDeviceId = `da_${randomBytes(8).toString("hex")}`;
	/** The service's session, once the phone unlocked. */
	token = "";
	/** "raw" is r||s, "der" is what Android gives. */
	encoding: "raw" | "der";
	private approval = pair();

	constructor(name = "Test phone", encoding: "raw" | "der" = "der") {
		this.name = name;
		this.encoding = encoding;
	}

	get keys(): NewDevice {
		return { name: this.name, approvalKey: this.approval.publicJwk };
	}

	private sign(key: KeyObject, message: string): string {
		return sign("sha256", Buffer.from(message), { key, dsaEncoding: this.encoding === "raw" ? "ieee-p1363" : "der" }).toString("base64url");
	}

	/** A request to the bank, with the service's session as the phone sends it. */
	request(origin: string, method: string, path: string, body = ""): Request {
		return new Request(new URL(path, origin), {
			method,
			headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
			...(body ? { body } : {}),
		});
	}

	/** The request for the sign-in code, signed by the approval key after the fingerprint. */
	signinCodeRequest(origin: string, at: { time?: number; nonce?: string; withOtherKey?: boolean } = {}): Request {
		const time = String(at.time ?? Date.now()), nonce = at.nonce ?? randomBytes(12).toString("base64url");
		const key = at.withOtherKey ? pair().privateKey : this.approval.privateKey;
		const body = JSON.stringify({ device_id: this.deviceId, nonce, time, signature: this.sign(key, signinCodeMessage({ origin, deviceId: this.deviceId, nonce, time })) });
		return new Request(new URL("/authenticator/signin-code", origin), { method: "POST", headers: { "content-type": "application/json" }, body });
	}

	/** An approval of one operation revision, as the phone signs it after the fingerprint. */
	approve(origin: string, operationId: string, revision: number, termsHash: string, at: { time?: number; nonce?: string } = {}): { signature: string; nonce: string; time: string } {
		const time = String(at.time ?? Date.now()), nonce = at.nonce ?? randomBytes(12).toString("base64url");
		return { signature: this.sign(this.approval.privateKey, approvalMessage({ origin, deviceId: this.deviceId, operationId, revision, termsHash, nonce, time })), nonce, time };
	}
}
