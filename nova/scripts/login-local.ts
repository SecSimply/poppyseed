/**
 * Proves the sign-in with Curity against a stand-in provider, for development: starts the mock provider
 * (../inspector/scripts/mock-oidc.ts) and a local production build of Protea Bank wired to it, then plays a stranger,
 * a customer, a person who is not a customer, a staff member and an attacker with a browser that keeps cookies.
 *
 *   node --experimental-strip-types --no-warnings scripts/login-local.ts     (after `next build`, run from nova/)
 *
 * Exits non-zero if any check fails. The mock signs in anyone: it never runs anywhere but here.
 */
import { spawn } from "node:child_process";
import { Browser } from "poppyseed/agent";

const mockPort = 3504;
const port = 3405;
const target = `http://localhost:${port}`;
const mock = `http://localhost:${mockPort}`;
const fetcher = globalThis.fetch.bind(globalThis);

for (const url of [target, mock]) if ((await fetch(url).catch(() => undefined)) !== undefined) throw new Error(`something is already listening on ${url}`);
const children = [
	spawn("node", ["--experimental-strip-types", "--no-warnings", "../inspector/scripts/mock-oidc.ts"], { env: { ...process.env, PORT: String(mockPort), CLIENT_ID: "protea-bank", REDIRECT_URI: `${target}/auth/callback` }, stdio: "ignore", detached: true }),
	spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
		env: {
			...process.env,
			NODE_ENV: "production",
			POPPYSEED_BASE_URL: target,
			POPPYSEED_SECRET: "local-secret-local-secret-local-secret-1",
			OIDC_ISSUER: mock,
			OIDC_CLIENT_ID: "protea-bank",
			OIDC_CLIENT_SECRET: "not-checked-by-the-mock",
			CUSTOMER_EMAILS: "thandi@proteabank.example=cus_thandi",
			STAFF_EMAILS: "sam@bank.example",
			POPPY_STAFF_KEY: "emergency-key-for-the-test",
		},
		stdio: "ignore",
		detached: true,
	}),
];
const stop = () => children.forEach((c) => { try { process.kill(-c.pid!); } catch { /* gone */ } });
process.on("exit", stop);
for (let i = 0; i < 80; i++) {
	const up = await Promise.all([target, `${mock}/jwks`].map((u) => fetch(u).then((r) => r.ok, () => false)));
	if (up.every(Boolean)) break;
	await new Promise((r) => setTimeout(r, 500));
}

let failed = false;
const expect = (ok: boolean, what: string) => {
	console.log(`  ${ok ? "✓" : "✗"} ${what}`);
	failed ||= !ok;
};
const as = (sub: string, email: string, name?: string) => fetch(`${mock}/_as?sub=${sub}&email=${encodeURIComponent(email)}${name ? `&name=${encodeURIComponent(name)}` : ""}`);
const plain = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ");

/** Follows redirects as a browser would, to a page that is not a redirect. Returns it, and the addresses on the way. */
async function visit(browser: Browser, path: string, init: RequestInit = {}) {
	const trail: string[] = [];
	let url = path.startsWith("http") ? path : `${target}${path}`;
	for (let i = 0; i < 10; i++) {
		const response = await browser.request(url, i === 0 ? init : {});
		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			url = new URL(location, url).toString();
			trail.push(url);
			continue;
		}
		return { response, text: plain(await response.text()), trail, url };
	}
	throw new Error("too many redirects");
}

console.log("a stranger");
const stranger = new Browser(fetcher);
let r = await visit(stranger, "/account");
expect(r.response.status === 200 && r.text.includes("Sign in") && !r.text.includes("Everyday Cheque"), "/account asks to sign in and shows no accounts");
const staffEntry = await stranger.request(`${target}/staff`);
expect(staffEntry.status >= 300 && staffEntry.status < 400 && (staffEntry.headers.get("location") ?? "").includes("/auth/login?as=staff"), "/staff sends a stranger to sign in as staff");
expect((await stranger.request(`${target}/auth/callback?code=x&state=y`)).status === 400, "a callback with no login in progress is refused");

console.log("\na customer, Thandi, signs in with Curity");
await as("curity-1", "Thandi@ProteaBank.example", "Thandi Nkosi");
const thandi = new Browser(fetcher);
r = await visit(thandi, "/login?return_to=/account");
expect(r.trail.some((u) => u.startsWith(mock)) && r.trail.at(-1) === `${target}/account`, "goes to Curity and comes back to the page she asked for");
expect(r.text.includes("Thandi Nkosi") && r.text.includes("R97") && r.text.includes("Protea Saver"), "/account shows her accounts, matched by her email in any case");
expect(r.text.includes("Sign out of Protea Bank"), "there is a sign-out button");
const cookie = thandi.cookieHeader;
expect(/pb_session=/.test(cookie) && !/pb_login/.test(cookie), "the session cookie is set and the login cookie is gone");
expect(!/thandi|nkosi|cus_/i.test(cookie), "nothing in the cookie can be read");
expect((await visit(thandi, "/payees")).text.includes("Save payee"), "she can add a payee in her own browser");
expect((await visit(thandi, "/staff")).text.includes("Not on the staff list"), "her login does not open the support console");
const replay = await new Browser(fetcher).request(r.trail.find((u) => u.includes("/auth/callback")) ?? `${target}/auth/callback`);
expect(replay.status === 400, "the callback address cannot be replayed from another browser");

console.log("\nan attacker");
const forged = await visit(new Browser(fetcher, "pb_session=cus_thandi"), "/account");
expect(forged.text.includes("Sign in") && !forged.text.includes("R97"), "a cookie that just names a customer is nothing");
const evil = await thandi.request(`${target}/auth/logout`, { method: "POST", headers: { origin: "https://evil.example" } });
expect(evil.status === 403 && (await visit(thandi, "/account")).text.includes("Thandi Nkosi"), "another site cannot sign her out");
const redirectTest = new Browser(fetcher);
r = await visit(redirectTest, "/auth/login?as=customer&return_to=https://evil.example/steal");
expect(new URL(r.url).origin === target, `a return_to on another site is ignored (landed on ${new URL(r.url).pathname})`);

console.log("\nThandi signs out");
const out = await thandi.request(`${target}/auth/logout`, { method: "POST", headers: { origin: target } });
expect(out.status === 303, "sign-out answers with a redirect");
r = await visit(thandi, "/account");
expect(r.text.includes("Sign in") && !r.text.includes("R97"), "she is signed out");

console.log("\nsomeone with a Curity login who is not a customer");
await as("curity-2", "someone@example.com", "Some One");
const visitor = new Browser(fetcher);
r = await visit(visitor, "/login?return_to=/account");
expect(r.text.includes("no Protea Bank customer behind this login") && !r.text.includes("Everyday Cheque"), "is signed in with no accounts, and is told why");
r = await visit(visitor, "/login");
expect(r.trail.every((u) => !u.startsWith(mock)) && r.text.includes("no Protea Bank customer"), "going to sign in again does not loop back to Curity");
expect((await visit(visitor, "/payments")).text.includes("no Protea Bank customer"), "/payments shows the same");

r = await visit(visitor, "/payments");
expect(/href="\/auth\/login\?as=customer&amp;fresh=1/.test(await (await visitor.request(`${target}/payments`)).text()), "the page offers a sign-in that asks Curity to check afresh");
const freshStart = await visitor.request(`${target}/auth/login?as=customer&fresh=1&return_to=/account`);
expect(new URL(freshStart.headers.get("location") ?? "", target).searchParams.get("prompt") === "login", "which sends prompt=login, as the staff sign-in does");
const plainStart = await new Browser(fetcher).request(`${target}/auth/login?as=customer&return_to=/account`);
expect(!new URL(plainStart.headers.get("location") ?? "", target).searchParams.has("prompt"), "an ordinary customer sign-in does not");

console.log("\nstaff, Sam, signs in with Curity");
await as("curity-3", "sam@bank.example", "Sam Dlamini");
const sam = new Browser(fetcher);
r = await visit(sam, "/staff");
expect(r.trail.some((u) => u.includes("/auth/login")) && r.trail.some((u) => u.startsWith(mock)), "Staff in the menu goes to Curity");
expect(r.text.includes("Agent handoffs") && r.text.includes("Sam Dlamini") && !r.text.includes("emergency key"), "and lands in the console, as Sam, by session");
expect(r.text.includes("Blocked agents") && r.text.includes("Reports from agents") && r.text.includes("What staff have done"), "with handoffs, blocked agents, reports and the log");
expect(!/name="key" value="[^"]/.test(await (await sam.request(`${target}/staff`)).text()), "no key is put in any form");
expect(/pb_session/.test(sam.cookieHeader), "the session lasts for staff as well");

console.log("\nthe emergency key");
await as("curity-2", "someone@example.com", "Some One"); // so a redirect to sign in does not quietly sign Sam in again
r = await visit(new Browser(fetcher), "/staff?key=emergency-key-for-the-test");
expect(r.text.includes("Agent handoffs") && r.text.includes("emergency key"), "still opens the console, and says so");
r = await visit(new Browser(fetcher), "/staff?key=wrong");
expect(!r.text.includes("Agent handoffs") && r.text.includes("Not on the staff list"), "a wrong key does not: it falls back to signing in, and a customer is not staff");

stop();
console.log(failed ? "\nFAILED" : "\nall good");
process.exit(failed ? 1 : 0);
