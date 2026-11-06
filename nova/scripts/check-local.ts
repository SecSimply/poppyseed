/**
 * Runs `poppyseed check` against a local production build of Protea Bank, with the test hooks on, and fails if a check
 * fails or if anything not listed below starts to skip. Run it from nova/ after `next build` (pnpm check does both).
 */
import { spawn } from "node:child_process";

const port = 3403;
const target = `http://localhost:${port}`;

/** Checks that skip because Protea Bank does not offer what they test. A skip that is not here is a gap. */
const SKIPPED_BY_DESIGN = [
	"mediated/sign-in", "mediated/failures", "mediated/code", "mediated/rate-limit", // Mediated Sign-In is off: a bank should not teach customers to type a password into an agent
	"identity/unregistered", // any agent may start a Session; a blocklist refuses particular ones
	"identity/private-agent-urls", // the check run allows loopback agents, which strict mode would refuse
	"tokens/rate-limit", // no request limit low enough to reach
	"conv/context-sticky", "conv/cursor-expired", "conv/operation-message", "conv/scopes", // the support assistant reads and explains; it never changes or proposes anything
	"ops/in-progress", "ops/unknown-outcome", "ops/website-confirm", // payments finish at once, and are confirmed by the agent or the Inspector, not on the website
];

if ((await fetch(target).catch(() => undefined))?.ok) throw new Error(`something is already listening on ${target}`);
const server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
	env: { ...process.env, NODE_ENV: "production", POPPYSEED_BASE_URL: target, POPPYSEED_SECRET: "local-secret-local-secret-local-secret-1", POPPYSEED_ALLOW_LOOPBACK_AGENTS: "1", POPPYSEED_TEST_HOOKS: "1" },
	stdio: "ignore",
	detached: true, // its own process group, so stopping it stops `next` and not just the wrapper
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
	if ((await fetch(target).catch(() => undefined))?.ok) break;
	await new Promise((r) => setTimeout(r, 500));
}

const check = spawn("pnpm", ["exec", "poppyseed", "check", target, "--hooks", `${target}/test-hooks`, "--allow-skip", SKIPPED_BY_DESIGN.join(",")], { stdio: "inherit" });
const code: number = await new Promise((resolve) => check.on("exit", (c) => resolve(c ?? 1)));
stop();
process.exit(code);
