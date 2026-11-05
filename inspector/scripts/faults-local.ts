/**
 * Runs every fault against a running inspector and prints how the target answered. Exits non-zero if any fault
 * was accepted, or any control request failed. It sends deliberately broken requests, so point it at your own site.
 *
 *   INSPECTOR=http://localhost:3001 node --experimental-strip-types scripts/faults-local.ts [fault-id ...]
 */
import type { InspectorConfig, ProtocolEvent } from "../shared/events.ts";

const inspector = process.env.INSPECTOR ?? "http://localhost:3001";
const headers: Record<string, string> = process.env.INSPECTOR_TOKEN ? { authorization: `Bearer ${process.env.INSPECTOR_TOKEN}` } : {};

const config = (await (await fetch(`${inspector}/api/config`, { headers })).json()) as InspectorConfig;
const wanted = process.argv.slice(2);
let failures = 0;

for (const fault of config.faults.filter((f) => !wanted.length || wanted.includes(f.id))) {
	const started = await fetch(`${inspector}/api/runs`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ fault: fault.id }) });
	const { runId } = (await started.json()) as { runId: string };
	const stream = await fetch(`${inspector}/api/runs/${runId}/events`, { headers });
	const lines: string[] = [];
	let ok = true;
	let buffer = "";
	for await (const chunk of stream.body!.pipeThrough(new TextDecoderStream())) {
		buffer += chunk;
		for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
			const line = buffer.slice(0, end).replace(/^data: /, "");
			buffer = buffer.slice(end + 2);
			if (!line.startsWith("{")) continue;
			const e = JSON.parse(line) as ProtocolEvent;
			if (e.type === "step.end" && e.step !== "discover") {
				lines.push(`   ${e.ok ? "·" : "✗"} ${e.step}: ${(e.error ?? e.summary[0] ?? "").split("\n")[0]}`);
			}
			if (e.type === "run.end") ok = e.ok;
		}
	}
	if (!ok) failures++;
	console.log(`${ok ? "✓" : "✗"} ${fault.id}`);
	if (!ok || process.env.VERBOSE) console.log(lines.join("\n"));
}
console.log(failures ? `\n${failures} fault(s) did not behave as required` : "\nevery fault was refused as required");
process.exit(failures ? 1 : 0);
