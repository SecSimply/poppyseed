/** What a phone app needs from the operations: the account's open proposals, declining one, and approval that only the app can give. */
import { expect, it } from "vitest";
import { z } from "zod";
import { guardedFrom } from "../src/guard.ts";
import { hostJson, Operations } from "../src/operations.ts";
import { memoryStore } from "../src/store.ts";
import type { OperationTool, SessionContext } from "../src/types.ts";

const session = (account: string, userId = "usr_1"): SessionContext => ({ sessionId: `ses_${account}`, clientId: "https://agent.example/c.json", userId, account: { id: account, scopes: ["pay"] } });

function setup() {
	const performed: string[] = [];
	const tool: OperationTool = {
		description: "pays",
		scope: "pay",
		input: z.object({ amount: z.string(), onSite: z.boolean().optional() }),
		operation: {
			propose: ({ amount, onSite }: { amount: string; onSite?: boolean }) => ({ summary: `Pay ${amount}`, terms: { amount }, key: `pay:${amount}`, approvalOnSite: onSite }),
			perform: ({ id }) => (performed.push(id), { summary: "Paid" }),
		},
	};
	return { operations: new Operations(memoryStore(), new Map([["pay", tool]])), tool, performed };
}

it("lists the account's open proposals, newest first, and not another account's, nor ones already decided", async () => {
	const { operations, tool } = setup();
	const first = await operations.propose("pay", tool, { amount: "1.00" }, session("acct_1"));
	const second = await operations.propose("pay", tool, { amount: "2.00" }, session("acct_1"));
	const other = await operations.propose("pay", tool, { amount: "3.00" }, session("acct_2"));
	expect((await operations.pending("acct_1")).map((o) => o.id)).toEqual([second.id, first.id]);
	expect((await operations.pending("acct_2")).map((o) => o.id)).toEqual([other.id]);
	expect(await operations.pending("acct_3")).toEqual([]);
	await (await operations.approve(first.id, "acct_1", 1)).settled;
	expect((await operations.pending("acct_1")).map((o) => o.id)).toEqual([second.id]);
});

it("lets only the owning account decline, and a declined proposal can no longer be approved or confirmed", async () => {
	const { operations, tool, performed } = setup();
	const op = await operations.propose("pay", tool, { amount: "1.00" }, session("acct_1"));
	await expect(operations.decline(op.id, "acct_2")).rejects.toMatchObject({ code: "operation_not_found" });
	expect((await operations.read(op.id))?.state).toBe("proposed");
	const declined = await operations.decline(op.id, "acct_1");
	expect(declined.state).toBe("cancelled");
	expect(declined.result?.summary).toMatch(/Declined/);
	expect(await operations.pending("acct_1")).toEqual([]);
	await (await operations.approve(op.id, "acct_1", 1)).settled;
	await (await operations.confirm(op.id, guardedFrom(session("acct_1")), { revision: 1, approved_by: "user" })).settled;
	expect(performed).toEqual([]);
	expect((await operations.decline(op.id, "acct_1")).state).toBe("cancelled");
});

it("leaves an operation that is already decided as it is when declined", async () => {
	const { operations, tool } = setup();
	const op = await operations.propose("pay", tool, { amount: "1.00" }, session("acct_1"));
	await (await operations.approve(op.id, "acct_1", 1)).settled;
	expect((await operations.decline(op.id, "acct_1")).state).toBe("succeeded");
});

it("refuses an agent's confirmation of an on-site-only proposal, even claiming the User's approval, and accepts the site's", async () => {
	const { operations, tool, performed } = setup();
	const op = await operations.propose("pay", tool, { amount: "9.00", onSite: true }, session("acct_1"));
	expect(op.userApprovalRequired).toBe(true);
	for (const approved_by of ["user", "standing_permission"]) {
		await expect(operations.confirm(op.id, guardedFrom(session("acct_1")), { revision: 1, approved_by })).rejects.toMatchObject({ status: 403, code: "user_approval_required" });
	}
	expect(performed).toEqual([]);
	await (await operations.approve(op.id, "acct_1", 1)).settled;
	expect(performed).toEqual([op.id]);
});

it("lets an agent that has the User's approval confirm an ordinary approval-required proposal, as the protocol says", async () => {
	const tool: OperationTool = {
		description: "pays",
		scope: "pay",
		input: z.object({}),
		operation: { propose: () => ({ summary: "Pay", terms: {}, userApprovalRequired: true }), perform: () => ({ summary: "Paid" }) },
	};
	const ops = new Operations(memoryStore(), new Map([["pay", tool]]));
	const op = await ops.propose("pay", tool, {}, session("acct_1"));
	await expect(ops.confirm(op.id, guardedFrom(session("acct_1")), { revision: 1, approved_by: "standing_permission" })).rejects.toMatchObject({ code: "user_approval_required" });
	await (await ops.confirm(op.id, guardedFrom(session("acct_1")), { revision: 1, approved_by: "user" })).settled;
	expect((await ops.read(op.id))?.state).toBe("succeeded");
});

it("treats a proposal that changes from ordinary to on-site-only as new terms, a new revision", async () => {
	let onSite = false;
	const tool: OperationTool = {
		description: "pays",
		scope: "pay",
		input: z.object({}),
		operation: { propose: () => ({ summary: "Pay", terms: {}, key: "k", userApprovalRequired: true, approvalOnSite: onSite }), perform: () => ({ summary: "Paid" }) },
	};
	const ops = new Operations(memoryStore(), new Map([["pay", tool]]));
	const first = await ops.propose("pay", tool, {}, session("acct_1"));
	onSite = true;
	const second = await ops.propose("pay", tool, {}, session("acct_1"));
	expect(second.id).toBe(first.id);
	expect(second.revision).toBe(2);
	expect(second.approvalOnSite).toBe(true);
});

it("tells the host which agent proposed an operation, which the agent's own view does not carry", async () => {
	const { operations, tool } = setup();
	const op = await operations.propose("pay", tool, { amount: "1.00" }, session("acct_1"));
	expect(hostJson(op).client_id).toBe("https://agent.example/c.json");
	expect(hostJson(op)).toMatchObject({ operation_id: op.id, revision: 1, state: "proposed" });
});
