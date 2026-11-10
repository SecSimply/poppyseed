/**
 * A phone, for tests: two P-256 keys that sign the way the Android app does, so the whole protocol can be proved without a device.
 * The real app has the same two keys in the secure hardware, and unlocks the approval key with the fingerprint.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type JsonWebKey, type KeyObject } from "node:crypto";
import { approvalMessage, requestMessage } from "./device-auth.ts";
import type { NewDevice, PublicJwk } from "./devices.ts";

const pair = (): { publicJwk: PublicJwk; privateKey: KeyObject } => {
	const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
	return { publicJwk: publicKey.export({ format: "jwk" }) as PublicJwk, privateKey };
};

/** What a fake phone keeps between runs: its name, its device id and both private keys. */
export interface SavedPhone {
	name: string;
	deviceId: string;
	auth: JsonWebKey;
	approval: JsonWebKey;
}

export class FakePhone {
	readonly name: string;
	deviceId = "";
	/** "raw" is r||s, "der" is what Android gives. */
	encoding: "raw" | "der";
	private auth = pair();
	private approval = pair();

	constructor(name = "Test phone", encoding: "raw" | "der" = "der") {
		this.name = name;
		this.encoding = encoding;
	}

	/** The phone as it was saved, for the command-line phone. */
	static from(saved: SavedPhone, encoding: "raw" | "der" = "der"): FakePhone {
		const phone = new FakePhone(saved.name, encoding);
		phone.deviceId = saved.deviceId;
		const restore = (jwk: JsonWebKey) => ({ publicJwk: createPublicKey(createPrivateKey({ key: jwk, format: "jwk" })).export({ format: "jwk" }) as PublicJwk, privateKey: createPrivateKey({ key: jwk, format: "jwk" }) });
		phone.auth = restore(saved.auth);
		phone.approval = restore(saved.approval);
		return phone;
	}

	save(): SavedPhone {
		return { name: this.name, deviceId: this.deviceId, auth: this.auth.privateKey.export({ format: "jwk" }), approval: this.approval.privateKey.export({ format: "jwk" }) };
	}

	get keys(): NewDevice {
		return { name: this.name, authKey: this.auth.publicJwk, approvalKey: this.approval.publicJwk };
	}

	private sign(key: KeyObject, message: string): string {
		return sign("sha256", Buffer.from(message), { key, dsaEncoding: this.encoding === "raw" ? "ieee-p1363" : "der" }).toString("base64url");
	}

	/** A signed request to the bank, with the headers the bank reads. */
	request(origin: string, method: string, path: string, body = "", at: { time?: number; nonce?: string } = {}): Request {
		const time = String(at.time ?? Date.now()), nonce = at.nonce ?? randomBytes(12).toString("base64url");
		const signature = this.sign(this.auth.privateKey, requestMessage({ method, host: new URL(origin).host, target: path, time, nonce, body }));
		return new Request(new URL(path, origin), {
			method,
			headers: { "x-device-id": this.deviceId, "x-device-time": time, "x-device-nonce": nonce, "x-device-signature": signature, ...(body ? { "content-type": "application/json" } : {}) },
			...(body ? { body } : {}),
		});
	}

	/** An approval of one operation revision, as the phone signs it after the fingerprint. */
	approve(origin: string, operationId: string, revision: number, termsHash: string, at: { time?: number; nonce?: string; withAuthKey?: boolean } = {}): { signature: string; nonce: string; time: string } {
		const time = String(at.time ?? Date.now()), nonce = at.nonce ?? randomBytes(12).toString("base64url");
		return { signature: this.sign(at.withAuthKey ? this.auth.privateKey : this.approval.privateKey, approvalMessage({ origin, deviceId: this.deviceId, operationId, revision, termsHash, nonce, time })), nonce, time };
	}
}
