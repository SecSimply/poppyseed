import type { AgentTurn, ToolResult } from "poppyseed";
import { describe, expect, it } from "vitest";
import { intentOf, proteaAgent } from "./support.ts";

describe("intentOf", () => {
	it.each([
		["Can I speak to a person?", "person"],
		["I want a human", "person"],
		["Please pay my rent", "pay"],
		["transfer R200 to savings", "pay"],
		["Show my recent transactions", "transactions"],
		["What have I spent this month", "transactions"],
		["What are my balances?", "balances"],
		["how much do I have", "balances"],
		["Where is your nearest branch?", "branch"],
		["Is there an ATM in Lakeside?", "branch"],
		["What are your savings rates?", "rates"],
		["tell me about a mortgage", "rates"],
		["hello", "help"],
	])("reads %j as %s", (text, intent) => {
		expect(intentOf(text)).toBe(intent);
	});

	it("puts a request for a person before everything else, so it is never missed", () => {
		expect(intentOf("I want to pay someone but also talk to a person")).toBe("person");
	});

	it("does not mistake a word that merely contains a keyword", () => {
		expect(intentOf("I am a payee")).toBe("help");
		expect(intentOf("the operator")).toBe("person");
	});
});

/** A turn that records what the agent said, and answers tool calls from a script. */
function turn(text: string, tools: Record<string, ToolResult>) {
	const said: string[] = [];
	const calls: string[] = [];
	let handedOff = false;
	const t = {
		latest: [{ id: "m", role: "user", author: { type: "agent" }, text }],
		say: async (s: string) => void said.push(s),
		callTool: async (name: string, input: unknown) => (calls.push(`${name}(${JSON.stringify(input)})`), tools[name] ?? { kind: "error", code: "unknown_tool", message: name }),
		handoff: async () => void (handedOff = true),
	} as unknown as AgentTurn;
	return { t, said, calls, handedOff: () => handedOff };
}
const output = (o: unknown): ToolResult => ({ kind: "output", output: o });
const needsScope = (scope: string): ToolResult => ({ kind: "authorization", error: "insufficient_scope", scope });

describe("proteaAgent", () => {
	it("hands off when asked for a person, and says nothing else", async () => {
		const x = turn("Can I talk to a human?", {});
		await proteaAgent.reply(x.t);
		expect(x.handedOff()).toBe(true);
		expect(x.said).toEqual([]);
		expect(x.calls).toEqual([]);
	});

	it("answers rates and branches without any sign-in, in plain text", async () => {
		const rates = turn("savings rates?", { get_rates: output({ rates: [{ name: "Protea Saver", rate_percent: 6.5, kind: "earned" }] }) });
		await proteaAgent.reply(rates.t);
		expect(rates.said[0]).toContain("Protea Saver 6.50% earned");
		const branch = turn("an ATM in Paarl", { find_branch: output({ branches: [{ name: "Paarl Head Office", city: "Paarl", address: "1 Protea Plein, Main Street, Paarl", hours: "Mon to Fri", atm: true }] }) });
		await proteaAgent.reply(branch.t);
		expect(branch.calls).toEqual(['find_branch({"city":"Paarl","atm_only":true})']);
		for (const said of [...rates.said, ...branch.said]) expect(said).not.toMatch(/[{}[\]<>]/);
	});

	it("shows balances from the caller's own accounts", async () => {
		const x = turn("what are my balances", { list_accounts: output({ accounts: [{ account_id: "a", name: "Everyday Cheque Account", type: "cheque", ending: "4821", balance: { amount: "4429.07" } }] }) });
		await proteaAgent.reply(x.t);
		expect(x.said[0]).toBe("Your balances: Everyday Cheque Account ending 4821, R4\u00a0429,07.");
	});

	it("says nothing itself when the caller has not signed in, leaving the platform's request for the scope as the only reply", async () => {
		const x = turn("my balances", { list_accounts: needsScope("accounts:read") });
		await proteaAgent.reply(x.t);
		expect(x.said).toEqual([]);
		const y = turn("recent transactions", { list_accounts: needsScope("accounts:read") });
		await proteaAgent.reply(y.t);
		expect(y.said).toEqual([]);
		expect(y.calls).toEqual(["list_accounts({})"]);
	});

	it("reads transactions from the cheque account, newest five", async () => {
		const x = turn("recent transactions", {
			list_accounts: output({ accounts: [{ account_id: "acc_s", name: "Protea Saver", type: "savings", ending: "9034", balance: { amount: "1" } }, { account_id: "acc_c", name: "Everyday Cheque Account", type: "cheque", ending: "4821", balance: { amount: "1" } }] }),
			list_transactions: output({ transactions: [{ date: "2026-11-05", description: "Boland Power", amount: { amount: "-96.40" } }] }),
		});
		await proteaAgent.reply(x.t);
		expect(x.calls[1]).toBe('list_transactions({"account_id":"acc_c","limit":5})');
		expect(x.said[0]).toContain("2026-11-05 Boland Power -R96,40");
	});

	it("never moves money in a chat, and points to the approval a payment needs", async () => {
		const x = turn("please pay my rent R14 500", {});
		await proteaAgent.reply(x.t);
		expect(x.calls).toEqual([]);
		expect(x.said[0]).toMatch(/can't make payments in a chat/);
		expect(x.said[0]).toMatch(/approve/);
	});

	it("says what it can do when it does not understand", async () => {
		const x = turn("blue banana", {});
		await proteaAgent.reply(x.t);
		expect(x.said[0]).toMatch(/rates.*branch.*balances/);
	});
});
