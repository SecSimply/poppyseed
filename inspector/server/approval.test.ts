import type { Operation, OperationReply } from "poppyseed/agent";
import { describe, expect, it } from "vitest";
import type { ProtocolEvent } from "../shared/events.ts";
import { approveOperation, type OperationAgent } from "./approval.ts";

const op = (over: Partial<Operation> = {}): Operation => ({ operation_id: "op_1", revision: 1, state: "proposed", summary: "Pay $9.00 to Someone", terms: { amount: "9.00" }, user_approval_required: false, confirmation: null, ...over }) as Operation;

/** An agent that records what it was asked to do and answers like a company that accepts it. */
function fakeAgent(refuseStanding = false) {
	const calls: string[] = [];
	const agent: OperationAgent = {
		async confirm(_t, o, approvedBy) {
			calls.push(`confirm:${approvedBy}`);
			if (refuseStanding && approvedBy === "standing_permission") throw new Error("user_approval_required");
			return { operation: op({ operation_id: o.operation_id, state: "succeeded", confirmation: { revision: 1, approved_by: String(approvedBy), confirmed_at: "now" }, result: { summary: "Paid." } }) } as OperationReply;
		},
		async cancel(_t, id) {
			calls.push("cancel");
			return op({ operation_id: id, state: "cancelled" });
		},
		async operation(_t, id) {
			calls.push("read");
			return { operation: op({ operation_id: id, state: "succeeded" }) } as OperationReply;
		},
	};
	return { agent, calls };
}

function run(operation: Operation, answer: "approve" | "decline", standingPermission: boolean, agent: OperationAgent) {
	const events: ProtocolEvent[] = [];
	let asked = 0;
	return approveOperation(agent, "tok", operation, { emit: (e) => events.push(e), decide: async () => (asked++, answer), standingPermission, sleep: async () => {} }).then((result) => ({ result, events, asked }));
}

describe("approveOperation", () => {
	it("asks the person, then confirms as the user, when there is no standing permission", async () => {
		const { agent, calls } = fakeAgent();
		const { result, asked, events } = await run(op(), "approve", false, agent);
		expect(asked).toBe(1);
		expect(calls).toEqual(["confirm:user"]);
		expect(result.operation.state).toBe("succeeded");
		expect(events.find((e) => e.type === "action.required")).toMatchObject({ kind: "approve-operation", title: "Approve or decline this operation" });
	});

	it("confirms under a standing permission without asking, when the company allows it", async () => {
		const { agent, calls } = fakeAgent();
		const { result, asked, events } = await run(op(), "approve", true, agent);
		expect(asked).toBe(0);
		expect(calls).toEqual(["confirm:standing_permission"]);
		expect(events.some((e) => e.type === "action.required")).toBe(false);
		expect(result.summary).toContain("within your standing permission: confirmed without asking");
		expect(result.summary).toContain("approved_by: standing_permission");
	});

	it("never relies on a standing permission for an operation that needs the person's own approval", async () => {
		const { agent, calls } = fakeAgent(true);
		const { asked, events } = await run(op({ user_approval_required: true }), "approve", true, agent);
		expect(asked).toBe(1);
		expect(calls).toEqual(["confirm:user"]);
		expect(events.find((e) => e.type === "action.required")).toMatchObject({ title: "Approve this yourself", lines: expect.arrayContaining([expect.stringMatching(/standing permission would be refused/)]) });
	});

	it("cancels and never confirms when the person declines, standing permission or not", async () => {
		for (const standing of [false, true]) {
			const { agent, calls } = fakeAgent();
			const { result } = await run(op({ user_approval_required: true }), "decline", standing, agent);
			expect(calls).toEqual(["cancel"]);
			expect(result.operation.state).toBe("cancelled");
		}
	});

	it("keeps asking the person for their own approval however many times, never falling back to the permission", async () => {
		const { agent, calls } = fakeAgent();
		await run(op({ user_approval_required: true }), "approve", true, agent);
		await run(op({ user_approval_required: true }), "approve", true, agent);
		expect(calls.filter((c) => c === "confirm:standing_permission")).toEqual([]);
	});

	it("waits for an operation that is still in progress until it is final", async () => {
		const events: ProtocolEvent[] = [];
		let reads = 0;
		const agent: OperationAgent = {
			confirm: async () => ({ operation: op({ state: "in_progress" }), retryAfter: "1" }) as OperationReply,
			cancel: async () => op({ state: "cancelled" }),
			operation: async () => ({ operation: op({ state: ++reads < 3 ? "in_progress" : "succeeded" }) }) as OperationReply,
		};
		const { operation } = await approveOperation(agent, "t", op(), { emit: (e) => events.push(e), decide: async () => "approve", standingPermission: false, sleep: async () => {} });
		expect(operation.state).toBe("succeeded");
		expect(reads).toBe(3);
	});
});
