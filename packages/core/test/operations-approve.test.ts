/** Approval by the account holder on the Company's website: who may approve, and that it runs once. Everything else is proved by the conformance suite. */
import { expect, it } from "vitest";
import { z } from "zod";
import { Operations } from "../src/operations.ts";
import { memoryStore } from "../src/store.ts";
import type { OperationTool, SessionContext } from "../src/types.ts";

const owner: SessionContext = { sessionId: "ses_1", clientId: "https://agent.example/c.json", userId: "usr_1", account: { id: "acct_1", scopes: ["pay"] } };

function setup() {
	const performed: { id: string; account: string }[] = [];
	const tool: OperationTool = {
		description: "pays",
		scope: "pay",
		input: z.object({ amount: z.string() }),
		operation: {
			propose: ({ amount }: { amount: string }) => ({ summary: `Pay ${amount}`, terms: { amount }, url: "https://bank.example/approve/{id}" }),
			perform: ({ id }, ctx) => {
				performed.push({ id, account: ctx.account?.id ?? "" });
				return { summary: "Paid" };
			},
		},
	};
	const operations = new Operations(memoryStore(), new Map([["pay", tool]]));
	return { operations, tool, performed };
}

it("puts the operation ID in the page's address", async () => {
	const { operations, tool } = setup();
	const op = await operations.propose("pay", tool, { amount: "10.00" }, owner);
	expect(op.url).toBe(`https://bank.example/approve/${op.id}`);
});

it("lets only the owning account approve, for the latest revision", async () => {
	const { operations, tool, performed } = setup();
	const op = await operations.propose("pay", tool, { amount: "10.00" }, owner);
	await expect(operations.approve(op.id, "acct_2", 1)).rejects.toMatchObject({ code: "operation_not_found" });
	await expect(operations.approve(op.id, "acct_1", 2)).rejects.toMatchObject({ code: "terms_changed" });
	expect(performed).toEqual([]);
	const { settled } = await operations.approve(op.id, "acct_1", 1);
	await settled;
	expect(performed).toEqual([{ id: op.id, account: "acct_1" }]);
	expect((await operations.read(op.id))?.confirmation?.approved_by).toBe("user");
});

it("performs once however often it is approved", async () => {
	const { operations, tool, performed } = setup();
	const op = await operations.propose("pay", tool, { amount: "10.00" }, owner);
	const all = await Promise.all([1, 2, 3, 4].map(() => operations.approve(op.id, "acct_1", 1)));
	await Promise.all(all.map((a) => a.settled));
	expect(performed).toHaveLength(1);
});
