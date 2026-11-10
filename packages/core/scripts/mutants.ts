/**
 * pnpm mutants [--full] [filter]: checks the checks, and the unit tests.
 * Each mutant in mutants.data.ts breaks one rule; the named check or unit
 * test must then fail. A surviving mutant means a test passes for the wrong
 * reason, or the mutant no longer matches the code. Every unit test must be
 * named by a unit mutant, so none is tautological.
 * By default only the named check runs per mutant; --full runs the whole
 * suite and lists every check that caught it. --published asks for a unit
 * mutant only from the tests of the published package (packages/core): every
 * mutant still runs and must be caught. The release workflow uses it, because
 * nova, inspector and oidc-login are not published; verify.yml asks for all.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTANTS, UNIT_MUTANTS } from "./mutants.data.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const coreSrc = join(here, "../src");
// The suite runs in-process against the reference company, from its own package.
const reference = join(root, "fixtures/reference");
const full = process.argv.includes("--full");
const published = process.argv.includes("--published");
const only = process.argv.slice(2).filter((arg) => arg !== "--full" && arg !== "--published");

// Mutants edit sources in place. Start from a clean tree so a restore can never clobber real work.
const mutable = [coreSrc];
try {
	execFileSync("git", ["diff", "--quiet", "--", ...mutable]);
} catch {
	console.error("✗ packages/core/src has uncommitted changes. Commit or stash them before running mutants.");
	process.exit(1);
}
// Ctrl-C reaches vitest too; let the finally below restore the file, then stop.
let interrupted = false;
process.on("SIGINT", () => (interrupted = true));
process.on("SIGTERM", () => (interrupted = true));

const reportPath = join(tmpdir(), `poppyseed-mutants-${process.pid}.json`);

/** Check ids whose test failed, from vitest's JSON report. Test titles start with the id: "<id>: <title> [<covers>]". */
function failedChecks(): string[] {
	if (!existsSync(reportPath)) return [];
	const report = JSON.parse(readFileSync(reportPath, "utf8")) as { testResults: { assertionResults: { title: string; status: string }[] }[] };
	return report.testResults.flatMap((file) => file.assertionResults.filter((test) => test.status === "failed").map((test) => test.title.split(": ")[0] ?? ""));
}

let survived = 0;
for (const mutant of MUTANTS.filter((m) => only.length === 0 || only.some((o) => m.name.includes(o) || m.caughtBy.includes(o)))) {
	const path = join(coreSrc, mutant.file);
	const original = readFileSync(path, "utf8");
	if (!original.includes(mutant.find)) {
		console.error(`✗ ${mutant.name}: pattern not found in ${mutant.file}. Update the mutant.`);
		survived++;
		continue;
	}
	writeFileSync(path, original.replace(mutant.find, mutant.replace));
	rmSync(reportPath, { force: true });
	try {
		// A mutant that hangs the suite is stopped and counts as surviving: vitest writes its report only at the end.
		const filter = full ? [] : ["-t", `${mutant.caughtBy.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}:`];
		execFileSync("npx", ["vitest", "run", "test/conformance.test.ts", "--reporter=json", "--outputFile", reportPath, ...filter], {
			cwd: reference,
			encoding: "utf8",
			stdio: "pipe",
			timeout: 300_000,
			killSignal: "SIGKILL",
		});
	} catch (error) {
		// vitest exits 1 when a test fails, which is what a caught mutant does.
		if ((error as { signal?: string }).signal === "SIGKILL") console.error(`  ${mutant.name}: the suite hung and was stopped after 5 minutes`);
	} finally {
		writeFileSync(path, original);
	}
	if (interrupted) {
		console.error(`\n✗ interrupted; restored ${mutant.file}`);
		process.exit(130);
	}
	const failed = failedChecks();
	if (failed.includes(mutant.caughtBy)) {
		const extra = failed.filter((id) => id !== mutant.caughtBy);
		console.log(`✓ ${mutant.name.padEnd(28)} caught by ${mutant.caughtBy}${extra.length ? ` (+${extra.join(", ")})` : ""}`);
	} else {
		survived++;
		console.error(`✗ ${mutant.name.padEnd(28)} survived: expected ${mutant.caughtBy} to fail${failed.length ? `, failed: ${failed.join(", ")}` : ""}`);
	}
}
/** Runs one unit test file; returns the full titles ("describe > it") of its failed tests, or all of them. */
function unitTests(test: string, which: "failed" | "all"): string[] {
	rmSync(reportPath, { force: true });
	const pkg = join(root, test.split("/").slice(0, 2).join("/"));
	try {
		execFileSync("npx", ["vitest", "run", join(root, test), "--reporter=json", "--outputFile", reportPath], { cwd: pkg, encoding: "utf8", stdio: "pipe", timeout: 300_000, killSignal: "SIGKILL" });
	} catch {
		// A failing test exits 1; the report says which.
	}
	if (!existsSync(reportPath)) return [];
	const report = JSON.parse(readFileSync(reportPath, "utf8")) as { testResults: { assertionResults: { ancestorTitles: string[]; title: string; status: string }[] }[] };
	return report.testResults.flatMap((file) =>
		file.assertionResults.filter((t) => which === "all" || t.status === "failed").map((t) => [...t.ancestorTitles, t.title].join(" > ")),
	);
}

const unitSelected = UNIT_MUTANTS.filter((m) => only.length === 0 || only.some((o) => m.name.includes(o) || m.caughtBy.includes(o) || m.test.includes(o)));
for (const mutant of unitSelected) {
	const path = join(root, mutant.file);
	const original = readFileSync(path, "utf8");
	if (original.split(mutant.find).length !== 2) {
		console.error(`✗ ${mutant.name}: pattern must occur exactly once in ${mutant.file}. Update the mutant.`);
		survived++;
		continue;
	}
	writeFileSync(path, original.replace(mutant.find, mutant.replace));
	let failed: string[];
	try {
		failed = unitTests(mutant.test, "failed");
	} finally {
		writeFileSync(path, original);
	}
	if (interrupted) {
		console.error(`\n✗ interrupted; restored ${mutant.file}`);
		process.exit(130);
	}
	if (failed.includes(mutant.caughtBy)) console.log(`✓ ${mutant.name.padEnd(28)} caught by ${mutant.test.split("/").at(-1)} › ${mutant.caughtBy}`);
	else {
		survived++;
		console.error(`✗ ${mutant.name.padEnd(28)} survived: expected "${mutant.caughtBy}" to fail${failed.length ? `, failed: ${failed.join("; ")}` : ""}`);
	}
}

// No tautological unit tests: each must be named by a mutant, or say why it can't be.
if (only.length === 0) {
	const asked = (file: string) => !published || file.startsWith("packages/core/");
	const files = [...new Set(UNIT_MUTANTS.map((m) => m.test))].filter(asked);
	const listed = execFileSync("git", ["ls-files", "*.test.ts"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && f !== "fixtures/reference/test/conformance.test.ts" && asked(f));
	for (const file of listed.filter((f) => !files.includes(f))) {
		survived++;
		console.error(`✗ ${file} has no unit mutant. Add one to UNIT_MUTANTS for each of its tests.`);
	}
	const named = new Set(UNIT_MUTANTS.map((m) => m.caughtBy));
	for (const file of files) {
		for (const title of unitTests(file, "all").filter((t) => !named.has(t))) {
			survived++;
			console.error(`✗ ${file} › ${title}: no mutant shows this test can fail. Add one to UNIT_MUTANTS; a test no mutant can break is tautological, so delete it.`);
		}
	}
}

rmSync(reportPath, { force: true });
if (survived > 0) {
	console.error(`\n${survived} mutant(s) survived. A check is passing for the wrong reason, or a mutant is stale.`);
	process.exit(1);
}
console.log("\nAll mutants caught.");
