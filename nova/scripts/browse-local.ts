/**
 * Drives a running local Nova Bank the way a personal agent's browser does (spec 5), and prints what each Session sees
 * on /account and /payments. For development only: it plays Nova's demo customer Ada to approve each sign-in.
 *
 *   TARGET=http://localhost:3400 node --experimental-strip-types --no-warnings scripts/browse-local.ts
 *
 * Exits non-zero if a page shows what the Session's scopes do not allow.
 */
import { Browser, httpAgentHost, PapError } from "poppyseed/agent";

const target = process.env.TARGET ?? "http://localhost:3400";
const fetcher = globalThis.fetch.bind(globalThis);
const host = await httpAgentHost();
const agent = await host.createAgent(fetcher);
await agent.discover(target);

const text = async (browser: Browser, path: string) => (await (await browser.request(new URL(path, target).toString())).text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
let failed = false;
const expect = (ok: boolean, what: string) => {
	console.log(`  ${ok ? "✓" : "✗"} ${what}`);
	failed ||= !ok;
};

async function signedIn(scope: string) {
	const session = await agent.startSession();
	const device = await agent.deviceAuthorization(scope);
	const ada = new Browser(fetcher, "nb_session=cus_ada");
	await ada.decide(await ada.enterUserCode(device.verification_uri, device.user_code), "approve");
	for (;;) {
		try {
			await agent.pollDevice(device.device_code, session.session);
			return session.session;
		} catch (error) {
			if (error instanceof PapError && error.error === "authorization_pending") await new Promise((r) => setTimeout(r, 1500));
			else throw error;
		}
	}
}

console.log("a stranger's browser (no Session)");
const stranger = new Browser(fetcher);
expect((await text(stranger, "/account")).includes("Sign in"), "/account asks to sign in");
expect(!(await text(stranger, "/account")).includes("Everyday Account"), "/account shows no accounts");

for (const scopes of [["accounts:read"], ["transactions:read"], ["accounts:read", "transactions:read"]]) {
	console.log(`\nan agent's browser signed in with: ${scopes.join(" ")}`);
	const key = await signedIn(scopes.join(" "));
	// The browser also holds Ada's site login: the agent's Session must win, and show only its own scopes.
	const browser = new Browser(fetcher, "nb_session=cus_ada");
	const joined = await agent.joinBrowser(browser, key);
	expect(joined.status === 303, `joined the browser (HTTP ${joined.status})`);
	const account = await text(browser, "/account");
	const payments = await text(browser, "/payments");
	expect(account.includes("A personal agent is viewing"), "the page says an agent is viewing");
	expect(scopes.includes("accounts:read") === account.includes("Everyday Account"), `/account balances shown only with accounts:read`);
	expect(scopes.includes("accounts:read") || account.includes("accounts:read scope"), "/account names the missing scope");
	expect(scopes.includes("transactions:read") ? payments.includes("Description") && !payments.includes("transactions:read scope") : !payments.includes("Description") && payments.includes("transactions:read scope"), "/payments shown only with transactions:read, else names the scope")
	expect(!account.includes("Connected personal agents") && !account.includes("Sign out of Nova"), "no connected-agents list or sign-out for an agent");
	expect(!account.includes("Ben Marlow") && !account.includes("1157"), "none of the other customer's data");
}

console.log("\nan agent's browser with no sign-in");
const anonymous = await agent.startSession();
const blank = new Browser(fetcher);
await agent.joinBrowser(blank, anonymous.session);
const page = await text(blank, "/account");
expect(page.includes("has not signed in") && !page.includes("Everyday Account"), "/account shows nothing and says the Session has not signed in");

await host.close();
console.log(failed ? "\nFAILED" : "\nall good");
process.exit(failed ? 1 : 0);
