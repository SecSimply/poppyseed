/**
 * Drives the real inspector UI in headless Chrome against a local inspector and a local Protea Bank, playing the person
 * who approves the sign-in, and prints what the page shows. For development only: it signs in as Protea's demo customer.
 *
 *   INSPECTOR=http://localhost:3001 TARGET=http://localhost:3400 node --experimental-strip-types --no-warnings scripts/ui-local.ts <operation index> <approve|decline> [screenshot.png]
 *
 * Needs Chrome (google-chrome) and the `ws` package from the workspace's dependencies.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Browser } from "poppyseed/agent";

const inspector = process.env.INSPECTOR ?? "http://localhost:3001";
const target = process.env.TARGET ?? "http://localhost:3400";
const operation = process.argv[2] ?? "0";
const decision = process.argv[3] === "decline" ? "decline" : "approve";
const shot = process.argv[4];

// `ws` is a transitive dependency, so find it in the pnpm store rather than assuming it is hoisted.
const store = join(import.meta.dirname, "../../node_modules/.pnpm");
const wsDir = readdirSync(store).find((d) => d.startsWith("ws@"));
if (!wsDir) throw new Error("no ws package in node_modules/.pnpm");
const WebSocket = createRequire(import.meta.url)(join(store, wsDir, "node_modules/ws")) as typeof import("ws").WebSocket;

const port = 9333;
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, "--window-size=1200,2400", "--user-data-dir=/tmp/inspector-ui-local", "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const finish = (code: number) => (chrome.kill(), process.exit(code));

for (let i = 0; i < 50; i++) {
	try {
		await fetch(`http://127.0.0.1:${port}/json/version`);
		break;
	} catch {
		await sleep(200);
	}
}
const page = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => socket.once("open", r));
let nextId = 1;
const pending = new Map<number, (value: any) => void>();
const consoleErrors: string[] = [];
socket.on("message", (raw: Buffer) => {
	const message = JSON.parse(String(raw));
	if (message.id && pending.has(message.id)) pending.get(message.id)!(message);
	if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text);
	if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map((a: any) => a.value ?? a.description).join(" "));
});
const send = (method: string, params: object = {}) =>
	new Promise<any>((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		socket.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const text = () => evaluate("document.body.innerText") as Promise<string>;
const click = (label: string) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`);
async function until(what: string, test: (t: string) => boolean, seconds: number): Promise<string> {
	for (let i = 0; i < seconds * 4; i++) {
		const t = await text();
		if (test(t)) return t;
		await sleep(250);
	}
	console.log(`TIMEOUT waiting for: ${what}\n--- page text now:\n${await text()}`);
	if (shot) writeFileSync(shot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
	finish(2);
	return "";
}

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: inspector });
await until("the run buttons", (t) => t.includes("Run with sign-in and operations"), 15);
console.log("page loaded; operations offered:", await evaluate(`[...document.querySelectorAll('select')].map((s) => [...s.options].map((o) => o.textContent))`));
await evaluate(`(() => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent.startsWith('Pay'))); if (!s) return; s.value = ${JSON.stringify(operation)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
console.log("clicked run:", await click("Run with sign-in and operations"));

// The sign-in panel appears; play the customer who approves it.
const waiting = await until("the sign-in panel", (t) => /Approve the sign-in/.test(t) && /[A-Z]{4}-[A-Z]{4}/.test(t), 60);
const code = /([A-Z]{4}-[A-Z]{4})/.exec(waiting)![1]!;
const link = await evaluate(`document.querySelector('[role=alert] a')?.href`);
console.log("sign-in panel shows code", code, "and link", link);
const ada = new Browser(globalThis.fetch.bind(globalThis), "pb_session=cus_thandi");
const page2 = new URL(link ?? `${target}/oauth/device`);
page2.search = "";
await ada.decide(await ada.enterUserCode(page2.toString(), code), "approve");
console.log("customer approved the sign-in");

if (operation === "1") {
	await until("the approve panel", (t) => /Approve this yourself/.test(t), 60);
	console.log("APPROVE PANEL SHOWN. Buttons:", await evaluate(`[...document.querySelectorAll('[role=alert] button')].map((b) => b.textContent)`));
	await click(decision === "approve" ? "Approve" : "Decline");
	console.log("clicked", decision);
}
const final = await until("the run to end", (t) => /all steps passed|stopped at a failing step|refused as required/.test(t), 90);
console.log("\n=== page text at the end ===\n" + final);
console.log("\nconsole errors:", consoleErrors.length ? consoleErrors : "none");
if (shot) writeFileSync(shot, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
finish(/all steps passed/.test(final) ? 0 : 1);
