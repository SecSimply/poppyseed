/**
 * Uses the Curity client file (nova/proteabankoidc.md) as the one place the client's details live.
 *
 *   node --experimental-strip-types --no-warnings scripts/oidc-env.ts --local      write nova/.env.development.local, so `pnpm dev` signs in with Curity
 *   node --experimental-strip-types --no-warnings scripts/oidc-env.ts --railway    set the OIDC_* variables on the nova-bank Railway service, without deploying
 *
 * Neither prints the secret. The file is git-ignored, and so is .env.development.local (which only `next dev` reads, so the
 * production-build scripts here are not affected by it).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { forLocal, parseOidcFile } from "../lib/oidc-file.ts";

const file = new URL("../proteabankoidc.md", import.meta.url);
const mode = process.argv[2];
const settings = parseOidcFile(readFileSync(file, "utf8"));

if (mode === "--local") {
	const target = new URL("../.env.development.local", import.meta.url);
	writeFileSync(target, Object.entries(forLocal(settings)).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
	console.log("wrote nova/.env.development.local: Curity sign-in for `pnpm dev` on http://localhost:3000 (add CUSTOMER_EMAILS and STAFF_EMAILS to it as needed)");
} else if (mode === "--railway") {
	// The redirect address is the deployed site's, so the file's own value is used as it is.
	const args = Object.entries(settings).flatMap(([k, v]) => ["--set", `${k}=${v}`]);
	const run = spawnSync("railway", ["variables", "--service", "nova-bank", ...args, "--skip-deploys"], { encoding: "utf8" });
	if (run.status !== 0) throw new Error(`railway failed (${run.status}): ${(run.stderr || run.stdout).replace(settings.OIDC_CLIENT_SECRET, "[hidden]").slice(0, 300)}`);
	console.log("set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI on nova-bank (no deploy)");
} else {
	console.error("usage: oidc-env.ts --local | --railway");
	process.exit(2);
}
