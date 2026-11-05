/**
 * Drives a running inspector through the sign-in and operations journey, playing the person who approves.
 * For local development only: it signs in as the Poppy Travel demo's test traveler (Maya), so TARGET must be the
 * demo site and the inspector must be running with it.
 *
 *   PERSON_COOKIE=nb_session=cus_ada (for Nova Bank) INSPECTOR=http://localhost:3001 TARGET=http://localhost:3300 node --experimental-strip-types scripts/e2e-local.ts [approve|decline]
 */
import { Browser } from "poppyseed/agent";
import type { ProtocolEvent } from "../shared/events.ts";

const inspector = process.env.INSPECTOR ?? "http://localhost:3001";
const target = process.env.TARGET ?? "http://localhost:3300";
const decision = process.argv[2] === "decline" ? "decline" : "approve";
const headers: Record<string, string> = process.env.INSPECTOR_TOKEN ? { authorization: `Bearer ${process.env.INSPECTOR_TOKEN}` } : {};

const started = await fetch(`${inspector}/api/runs`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ signIn: true, ...(process.env.OPERATION ? { operation: Number(process.env.OPERATION) } : {}) }) });
const { runId } = (await started.json()) as { runId: string };
const stream = await fetch(`${inspector}/api/runs/${runId}/events`, { headers });

const maya = new Browser(globalThis.fetch.bind(globalThis), process.env.PERSON_COOKIE ?? "pt_session=trv_maya");
let failed = false;
let buffer = "";
for await (const chunk of stream.body!.pipeThrough(new TextDecoderStream())) {
	buffer += chunk;
	for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
		const line = buffer.slice(0, end).replace(/^data: /, "");
		buffer = buffer.slice(end + 2);
		if (!line.startsWith("{")) continue;
		const e = JSON.parse(line) as ProtocolEvent;
		if (e.type === "http") console.log(`  ${e.step.padEnd(8)} ${e.request.method.padEnd(4)} ${new URL(e.request.url).pathname} → ${e.response?.status ?? e.error}`);
		else if (e.type === "step.end") {
			console.log(`${e.ok ? "✓" : "✗"} ${e.step}${e.error ? `: ${e.error.slice(0, 300)}` : ""}${e.summary.length ? `\n    ${e.summary.join("\n    ").slice(0, 400)}` : ""}`);
			failed ||= !e.ok;
		} else if (e.type === "action.required") {
			console.log(`⏸ waiting: ${e.title}${e.code ? ` [code ${e.code}]` : ""}`);
			if (e.kind === "device-signin") {
				// Maya opens the company's page on her own device, checks the code, approves.
				const page = new URL(e.link!);
				page.search = "";
				const form = await maya.enterUserCode(page.toString(), e.code!);
				await maya.decide(form, "approve");
			} else if (e.kind === "approve-operation") {
				await fetch(`${inspector}/api/runs/${runId}/decision`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ decision }) });
			} else console.log("  (needs a person on the company's page: not simulated)");
		} else if (e.type === "run.end") console.log(`run ${e.ok ? "passed" : "FAILED"}`);
	}
}
process.exit(failed ? 1 : 0);
