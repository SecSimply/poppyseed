/**
 * Writes the test vectors the Android app checks itself against: what the bank's own code (lib/device-auth.ts) produces for
 * canonical JSON, the terms hash and the two signed messages, and a signature by a throwaway key that the app must verify.
 * If the app and the bank ever disagree about a byte, an app unit test fails here instead of a payment failing on a phone.
 *   node --experimental-strip-types --no-warnings scripts/authenticator-vectors.ts
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { approvalMessage, bodyHash, canonicalJson, requestMessage, termsHash } from "../lib/device-auth.ts";

const out = new URL("../../protea-app/app/src/test/resources/vectors.json", import.meta.url);

const canonical = [
	{ a: 1 }, { b: 2, a: 1 }, { z: { y: [3, { b: true, a: null }], x: "s" }, a: [] },
	{ text: 'quote " backslash \\ tab \t newline \n return \r bell \u0007 unit \u001f del \u007f' },
	{ text: "Ünïcode ñ 日本語 😀 and     line separators" },
	{ "κλειδί": 1, "key": 2, "Key": 3, "😀": 4, "～": 5 },
	{ big: 9007199254740991, neg: -42, zero: 0, flag: false },
].map((input) => ({ input, canonical: canonicalJson(input) }));

const operations = [
	{
		summary: "Pay R10,00 to Boland Power (account ending 7741) from Everyday Cheque Account ••4821. The money leaves today and can't be recalled.",
		terms: { payee_id: "pye_thandi_energy", from_account_id: "acc_thandi_everyday", amount: { amount: "10.00", currency: "ZAR" } },
	},
	{
		summary: 'Transfer R1 500,00 to "Saver" – with a “note” and ünïcode 😀',
		terms: { to_account_id: "acc_thandi_saver", from_account_id: "acc_thandi_everyday", amount: { currency: "ZAR", amount: "1500.00" }, reference: "Rent \\ Oct\n" },
	},
].map((o) => ({ ...o, hash: termsHash(o.summary, o.terms) }));

const requests = [
	{ method: "get", host: "app.proteabank.co.za", target: "/authenticator/operations", time: "1731254400000", nonce: "bm9uY2UtMQ", body: "" },
	{ method: "POST", host: "app.proteabank.co.za", target: "/authenticator/operations/op_abc/approve?x=1", time: "1731254400123", nonce: "bm9uY2UtMg", body: '{"revision":1,"approval":{"signature":"s","nonce":"n","time":"1731254400000"}}' },
].map((r) => ({ ...r, bodyHash: bodyHash(r.body), message: requestMessage(r) }));

const approvals = [
	{ origin: "https://app.proteabank.co.za", deviceId: "dev_abc", operationId: "op_xyz", revision: 2, termsHash: operations[0]!.hash, nonce: "YXBwcm92YWw", time: "1731254400000" },
].map((a) => ({ ...a, message: approvalMessage(a) }));

// A throwaway key, new on each run. The app must verify both signature encodings and read the key from a JWK.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const message = requests[1]!.message;
const signatures = {
	jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
	message,
	der: sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "der" }).toString("base64url"),
	raw: sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url"),
};

mkdirSync(new URL(".", out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ canonical, operations, requests, approvals, signatures }, null, 2)}\n`);
console.log(`wrote ${out.pathname}`);
