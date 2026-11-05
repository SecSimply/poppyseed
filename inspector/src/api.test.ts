import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProtocolEvent } from "../shared/events.ts";
import { Gone, streamRun, Unauthorized } from "./api.ts";

const ev = (n: number) => ({ type: "step.start", step: `s${n}`, title: `Step ${n}`, at: n }) as unknown as ProtocolEvent;
const page = (events: ProtocolEvent[], next: number, done = false) => new Response(JSON.stringify({ events, next, done }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

/** Answers each poll with the next scripted reply, and records what was asked for. */
function script(replies: (Response | Error)[]) {
	const asked: string[] = [];
	vi.stubGlobal("fetch", async (url: string) => {
		asked.push(url);
		const reply = replies.shift();
		if (!reply) throw new Error("asked for more than the script has");
		if (reply instanceof Error) throw reply;
		return reply;
	});
	return asked;
}
const read = (onEvent: (e: ProtocolEvent) => void = () => {}) => streamRun("", "run-1", onEvent, new AbortController().signal, 1);

describe("streamRun", () => {
	it("delivers events in order across polls, resuming where the last one ended, and stops when the run is done", async () => {
		const asked = script([page([ev(1), ev(2)], 2), page([], 2), page([ev(3)], 3, true)]);
		const got: string[] = [];
		await read((e) => got.push((e as { step: string }).step));
		expect(got).toEqual(["s1", "s2", "s3"]);
		expect(asked).toEqual(["/api/runs/run-1/poll?from=0", "/api/runs/run-1/poll?from=2", "/api/runs/run-1/poll?from=2"]);
	});

	it("carries on from the last event after a dropped connection, without repeating or missing one", async () => {
		const asked = script([page([ev(1)], 1), new TypeError("network"), new Response("bad gateway", { status: 502 }), page([ev(2)], 2, true)]);
		const got: string[] = [];
		await read((e) => got.push((e as { step: string }).step));
		expect(got).toEqual(["s1", "s2"]);
		expect(asked.slice(1).every((u) => u.endsWith("from=1"))).toBe(true);
	});

	it("gives up after repeated failures instead of retrying for ever", async () => {
		script(Array.from({ length: 30 }, () => new TypeError("network")));
		await expect(read()).rejects.toThrow("network");
	});

	it("says so, without retrying, when the run is gone or the login has ended", async () => {
		const gone = script([new Response("{}", { status: 404 })]);
		await expect(read()).rejects.toBeInstanceOf(Gone);
		expect(gone).toHaveLength(1);
		script([new Response("{}", { status: 401 })]);
		await expect(read()).rejects.toBeInstanceOf(Unauthorized);
	});

	it("stops quietly when the page asks it to", async () => {
		const controller = new AbortController();
		vi.stubGlobal("fetch", async () => (controller.abort(), page([], 0)));
		const events: ProtocolEvent[] = [];
		await streamRun("", "run-1", (e) => events.push(e), controller.signal, 1);
		expect(events).toEqual([]);
	});
});
