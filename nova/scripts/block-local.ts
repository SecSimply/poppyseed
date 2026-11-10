/**
 * Proves, against a local production build of Protea Bank started by this script, that what the bank excludes is
 * excluded on every interface, that feedback is answered, and that a blocked agent is refused. For development only.
 *
 *   node --experimental-strip-types --no-warnings scripts/block-local.ts     (after `next build`, run from nova/)
 *
 * Exits non-zero on the first thing that does not hold.
 */
import { spawn } from "node:child_process";
import { Browser, httpAgentHost, PapError } from "poppyseed/agent";
import { personCookie } from "./person.ts";

const port = 3401;
const target = `http://localhost:${port}`;
const fetcher = globalThis.fetch.bind(globalThis);
const host = await httpAgentHost();
const allowed = await host.createAgent(fetcher);
const refused = await host.createAgent(fetcher);

if ((await fetch(target).catch(() => undefined))?.ok) throw new Error(`something is already listening on ${target}`);
const server = spawn("npx", ["next", "start", "-p", String(port)], {
	env: { ...process.env, NODE_ENV: "production", POPPYSEED_BASE_URL: target, POPPYSEED_SECRET: "local-secret-local-secret-local-secret-1", POPPYSEED_ALLOW_LOOPBACK_AGENTS: "1", BLOCKED_CLIENTS: refused.clientId },
	stdio: "ignore",
	detached: true, // its own process group, so stopping it stops `next` and not just `npx`
});
const stop = () => {
	try {
		process.kill(-server.pid!);
	} catch {
		// already gone
	}
};
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
	try {
		await fetch(target);
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 500));
	}
}

let failed = false;
const expect = (ok: boolean, what: string) => {
	console.log(`  ${ok ? "✓" : "✗"} ${what}`);
	failed ||= !ok;
};
const text = async (browser: Browser, path: string) => (await (await browser.request(`${target}${path}`)).text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

console.log("a blocked agent");
await refused.discover(target);
try {
	await refused.startSession();
	expect(false, "is refused at its first Session");
} catch (error) {
	expect(error instanceof PapError && error.error === "invalid_client", `is refused at its first Session (${error instanceof PapError ? error.error : error})`);
}

console.log("\nan agent that is not blocked");
await allowed.discover(target);
const session = await allowed.startSession();
expect(!!session.access_token, "starts a Session");

const doc = await allowed.excludedTasks();
console.log("  excluded:", doc.tasks.map((t) => t.task).join("; "));
expect(doc.tasks.length === 3 && doc.tasks.every((t) => t.alternative?.instructions), "reads the excluded-tasks document, each task with an alternative");

const bound = await allowed.startSession({ session: session.session, resource: allowed.endpoint("mcp") });
const listed = await allowed.mcp<{ tools?: { name: string }[] }>(allowed.endpoint("mcp"), bound.access_token, "tools/list");
const names = (listed.tools ?? []).map((t) => t.name);
console.log("  tools:", names.join(", "));
expect(!names.some((n) => /add_payee|create_payee|close|international|swift/i.test(n)), "has no tool for an excluded task");

const reply = await allowed.startConversation(session.access_token, allowed.message("Please add a new payee for my landlord"), { wait: 15 });
let events = reply.events ?? [];
for (let i = 0; i < 4 && !events.some((e) => e.type === "message" && e.message?.role === "company"); i++) events = [...events, ...(await allowed.events(session.access_token, reply.conversation_id, { cursor: reply.cursor ?? undefined, wait: 15 })).events];
const said = events.find((e) => e.type === "message" && e.message?.role === "company")?.message?.text ?? "";
console.log("  chat:", said.slice(0, 160));
expect(/can't do that for you here \(add a new payee\)/.test(said), "the support chat declines the task and says where to do it");

const fb = await allowed.feedback(session.access_token, { kind: "missing", task: "See what I spent last month", description: "I could not find the spending for October." });
expect(fb.httpStatus === 200 && JSON.stringify(fb.alternative).includes("list_transactions"), `feedback about a task the bank offers is answered with how (HTTP ${fb.httpStatus})`);
const fb2 = await allowed.feedback(session.access_token, { kind: "missing", task: "Order a debit card", description: "Needs a card." });
expect(fb2.httpStatus === 202, `feedback about a task that is missing is accepted (HTTP ${fb2.httpStatus})`);

console.log("\nthe website");
const thandi = new Browser(fetcher, await personCookie("cus_thandi"));
const own = await text(thandi, "/payees");
expect(own.includes("Save payee"), "the customer's own browser can add a payee");

// An agent's browser, signed in with the scope that reads payees, still gets no way to add one.
const device = await allowed.deviceAuthorization("payments:write");
const person = new Browser(fetcher, await personCookie("cus_thandi"));
await person.decide(await person.enterUserCode(device.verification_uri, device.user_code), "approve");
for (;;) {
	try {
		await allowed.pollDevice(device.device_code, session.session);
		break;
	} catch (error) {
		if (error instanceof PapError && error.error === "authorization_pending") await new Promise((r) => setTimeout(r, 1500));
		else throw error;
	}
}
const agentBrowser = new Browser(fetcher, await personCookie("cus_thandi")); // it also holds the customer's login: the Session must win
await allowed.joinBrowser(agentBrowser, session.session);
const agentView = await text(agentBrowser, "/payees");
expect(agentView.includes("Sipho Dlamini") && agentView.includes("isn't something Protea Bank offers") && !agentView.includes("Save payee"), "an agent's browser sees the payees but is given no way to add one");

// Posting to the action itself, without loading the page, must not get around the page: a form's action can be called on its own.
const html = await (await thandi.request(`${target}/payees`)).text();
const actionField = /name="(\$ACTION_ID_[0-9a-f]+)"/.exec(html)?.[1];
expect(!!actionField, "found the add-payee action to call directly");
const post = async (cookie: string, name: string) => {
	const body = new FormData();
	body.set(actionField!, "");
	body.set("name", name);
	body.set("account", "123456789");
	await fetch(`${target}/payees`, { method: "POST", headers: { cookie }, body, redirect: "manual" });
	return (await text(thandi, "/payees")).includes(name);
};
expect(await post(agentBrowser.cookieHeader, "Agent Added Payee") === false, "calling the action with an agent's Session adds no payee");
expect(await post(thandi.cookieHeader, "Customer Added Payee") === true, "the same call from the customer's own browser does (so the refusal is the Session, not the request)");

stop();
await host.close();
console.log(failed ? "\nFAILED" : "\nall good");
process.exit(failed ? 1 : 0);
