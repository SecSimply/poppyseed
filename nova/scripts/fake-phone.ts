/**
 * A phone on the command line, to try the Protea app's side of the bank without the app: it makes the two keys, enrolls from the link
 * the account page shows, and lists, approves or declines what agents ask for, signing exactly as the app does.
 *
 *   node --experimental-strip-types --no-warnings scripts/fake-phone.ts enroll "protea://enroll?o=…&e=…&s=…" ["Phone name"]
 *   node --experimental-strip-types --no-warnings scripts/fake-phone.ts list
 *   node --experimental-strip-types --no-warnings scripts/fake-phone.ts approve <operation_id>
 *   node --experimental-strip-types --no-warnings scripts/fake-phone.ts decline <operation_id>
 *
 * The keys are kept in ~/.protea-fake-phone.json (mode 600), or the file named by PHONE_STATE. It is a test tool: its keys are in a file.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { termsHash } from "../lib/device-auth.ts";
import { FakePhone, type SavedPhone } from "../lib/fake-phone.ts";

const file = process.env.PHONE_STATE ?? `${homedir()}/.protea-fake-phone.json`;
const [command, arg, name] = process.argv.slice(2);

interface State extends SavedPhone {
	origin: string;
}
const load = (): { phone: FakePhone; origin: string } => {
	if (!existsSync(file)) throw new Error(`no phone yet: run enroll first (${file})`);
	const state = JSON.parse(readFileSync(file, "utf8")) as State;
	return { phone: FakePhone.from(state), origin: state.origin };
};

async function send(phone: FakePhone, origin: string, method: string, path: string, body = "") {
	const res = await fetch(phone.request(origin, method, path, body));
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

if (command === "enroll") {
	const link = new URL(arg ?? "");
	if (link.protocol !== "protea:") throw new Error('give the link from the account page: "protea://enroll?o=…&e=…&s=…"');
	const origin = link.searchParams.get("o") ?? "";
	const phone = new FakePhone(name ?? "Command-line phone");
	const res = await fetch(`${origin}/authenticator/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollment_id: link.searchParams.get("e"), secret: link.searchParams.get("s"), name: phone.name, auth_key: phone.keys.authKey, approval_key: phone.keys.approvalKey }) });
	const body = (await res.json()) as { device_id?: string; code?: string; customer?: string; message?: string };
	if (!res.ok) throw new Error(`the bank said ${res.status}: ${body.message}`);
	phone.deviceId = body.device_id ?? "";
	writeFileSync(file, JSON.stringify({ ...phone.save(), origin }), { mode: 0o600 });
	chmodSync(file, 0o600);
	console.log(`Enrolled "${phone.name}" for ${body.customer ?? "a customer"} at ${origin}.\nThe code is ${body.code}. Confirm it on the account page; the device is not active until you do.`);
} else if (command === "list") {
	const { phone, origin } = load();
	const { status, body } = await send(phone, origin, "GET", "/authenticator/operations");
	if (status !== 200) throw new Error(`the bank said ${status}: ${JSON.stringify(body)}`);
	for (const op of body.operations) console.log(`${op.operation_id}  revision ${op.revision}  ${op.summary}\n    asked by ${op.agent.name}, expires ${op.expires_at}`);
	if (body.operations.length === 0) console.log("Nothing is waiting.");
} else if (command === "approve" || command === "decline") {
	const { phone, origin } = load();
	const id = arg ?? "";
	const shown = await send(phone, origin, "GET", `/authenticator/operations/${id}`);
	if (shown.status !== 200) throw new Error(`the bank said ${shown.status}: ${JSON.stringify(shown.body)}`);
	const op = shown.body;
	// The phone signs what it computes from what it shows, not the hash the bank sent.
	const hash = termsHash(op.summary, op.terms);
	if (hash !== op.terms_hash) throw new Error("the terms hash the bank sent is not the hash of the terms it showed: refusing");
	console.log(`${command === "approve" ? "Approving" : "Declining"}: ${op.summary}`);
	const body = command === "approve" ? JSON.stringify({ revision: op.revision, approval: phone.approve(origin, id, op.revision, hash) }) : "{}";
	const done = await send(phone, origin, "POST", `/authenticator/operations/${id}/${command}`, body);
	console.log(done.status, JSON.stringify(done.body?.operation?.state ?? done.body));
} else {
	console.log("usage: fake-phone.ts enroll <link> [name] | list | approve <operation_id> | decline <operation_id>");
}
