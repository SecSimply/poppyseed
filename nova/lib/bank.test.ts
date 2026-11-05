import { describe, expect, it } from "vitest";
import { ACCOUNTS, accountOf, accountsOf, balanceCents, money, movePayment, needsOwnApproval, parseAmount, payeeOf, payeesOf, TRANSACTIONS, transactionsOf, usd } from "./bank.ts";

describe("ownership", () => {
	it("gives a customer only their own accounts", () => {
		expect(accountsOf("cus_ada").every((a) => a.customerId === "cus_ada")).toBe(true);
		expect(accountsOf("cus_ada").length).toBeGreaterThan(0);
		expect(accountsOf("cus_nobody")).toEqual([]);
	});

	it("treats another customer's account as if it did not exist", () => {
		expect(accountOf("cus_ada", "acc_ada_saver")).toBeDefined();
		expect(accountOf("cus_ada", "acc_ben_everyday")).toBeUndefined();
		expect(accountOf("cus_ben", "acc_ada_saver")).toBeUndefined();
	});
});

describe("balances and transactions", () => {
	it("computes a balance from the opening balance and every transaction", () => {
		const account = ACCOUNTS.find((a) => a.id === "acc_ada_saver")!;
		const sum = TRANSACTIONS.filter((t) => t.accountId === account.id).reduce((s, t) => s + t.cents, 0);
		expect(balanceCents(account)).toBe(account.openingCents + sum);
	});

	it("lists transactions newest first, within a date range and a limit, and only for that account", () => {
		const account = accountOf("cus_ada", "acc_ada_everyday")!;
		const all = transactionsOf(account, { limit: 100 });
		expect(all.every((t) => t.accountId === account.id)).toBe(true);
		expect([...all].sort((a, b) => b.date.localeCompare(a.date))).toEqual(all);
		expect(transactionsOf(account, { limit: 3 })).toHaveLength(3);
		const middle = all[5]!.date;
		expect(transactionsOf(account, { from: middle, limit: 100 }).every((t) => t.date >= middle)).toBe(true);
		expect(transactionsOf(account, { to: middle, limit: 100 }).every((t) => t.date <= middle)).toBe(true);
	});

	it("never carries a balance on a transaction", () => {
		const account = accountOf("cus_ada", "acc_ada_everyday")!;
		for (const t of transactionsOf(account)) expect(Object.keys(t)).not.toContain("balance");
	});

	it("writes dollars with a currency sign, thousands separators and two decimals", () => {
		expect(usd(9_640)).toBe("$96.40");
		expect(usd(145_000)).toBe("$1,450.00");
		expect(usd(-575)).toBe("-$5.75");
		expect(usd(5)).toBe("$0.05");
	});

	it("formats money with two decimals, negatives included", () => {
		expect(money(172_500)).toEqual({ amount: "1725.00", currency: "USD" });
		expect(money(-575)).toEqual({ amount: "-5.75", currency: "USD" });
		expect(money(5)).toEqual({ amount: "0.05", currency: "USD" });
	});
});

describe("amounts", () => {
	it("reads whole and two-decimal amounts as cents", () => {
		expect(parseAmount("96.40")).toBe(9_640);
		expect(parseAmount("250")).toBe(25_000);
		expect(parseAmount("0.5")).toBe(50);
		expect(parseAmount(" 12.00 ")).toBe(1_200);
	});

	it.each(["", "0", "0.00", "-5", "1,000", "12.345", "1e3", "abc", "99999999", "5."])("refuses %j", (text) => {
		expect(parseAmount(text)).toBeUndefined();
	});

	it("asks for the customer's own approval strictly above the limit", () => {
		expect(needsOwnApproval("payee", 25_000)).toBe(false);
		expect(needsOwnApproval("payee", 25_001)).toBe(true);
		expect(needsOwnApproval("transfer", 500_000)).toBe(false);
		expect(needsOwnApproval("transfer", 500_001)).toBe(true);
	});
});

describe("payees", () => {
	it("are a customer's own, and another's look like none", () => {
		expect(payeesOf("cus_ada").every((p) => p.customerId === "cus_ada")).toBe(true);
		expect(payeeOf("cus_ada", "pye_ada_rent")).toBeDefined();
		expect(payeeOf("cus_ada", "pye_ben_rent")).toBeUndefined();
	});
});

describe("movePayment", () => {
	const ada = () => accountOf("cus_ada", "acc_ada_everyday")!;

	it("moves the money once, however often the same operation is performed", () => {
		const before = balanceCents(ada());
		const first = movePayment("op_once", "cus_ada", { from: "acc_ada_everyday", description: "Tidewater Energy", category: "payment", cents: 9_640 });
		const again = movePayment("op_once", "cus_ada", { from: "acc_ada_everyday", description: "Tidewater Energy", category: "payment", cents: 9_640 });
		expect(first).toEqual({ ok: true, reference: expect.stringMatching(/^PAY-/) });
		expect(again).toEqual(first);
		expect(balanceCents(ada())).toBe(before - 9_640);
	});

	it("credits the other account on a transfer, so the total stays the same", () => {
		const saver = accountOf("cus_ada", "acc_ada_saver")!;
		const total = balanceCents(ada()) + balanceCents(saver);
		expect(movePayment("op_xfer", "cus_ada", { from: "acc_ada_everyday", to: "acc_ada_saver", description: "Transfer to Nova Saver", category: "transfer", cents: 10_000 }).ok).toBe(true);
		expect(balanceCents(ada()) + balanceCents(saver)).toBe(total);
	});

	it("moves nothing when the money is not there, and remembers that answer", () => {
		const before = balanceCents(ada());
		const result = movePayment("op_poor", "cus_ada", { from: "acc_ada_everyday", description: "Too much", category: "payment", cents: before + 1 });
		expect(result).toEqual({ ok: false, reason: expect.stringMatching(/not enough money/) });
		expect(balanceCents(ada())).toBe(before);
	});

	it("never touches another customer's account", () => {
		const ben = accountOf("cus_ben", "acc_ben_everyday")!;
		const before = balanceCents(ben);
		expect(movePayment("op_theft", "cus_ada", { from: "acc_ben_everyday", description: "x", category: "payment", cents: 100 }).ok).toBe(false);
		expect(movePayment("op_theft2", "cus_ada", { from: "acc_ada_everyday", to: "acc_ben_everyday", description: "x", category: "transfer", cents: 100 }).ok).toBe(false);
		expect(balanceCents(ben)).toBe(before);
	});
});
