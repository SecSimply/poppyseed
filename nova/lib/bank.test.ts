import { describe, expect, it } from "vitest";
import { ACCOUNTS, accountOf, accountsOf, balanceCents, money, TRANSACTIONS, transactionsOf } from "./bank.ts";

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

	it("formats money with two decimals, negatives included", () => {
		expect(money(172_500)).toEqual({ amount: "1725.00", currency: "USD" });
		expect(money(-575)).toEqual({ amount: "-5.75", currency: "USD" });
		expect(money(5)).toEqual({ amount: "0.05", currency: "USD" });
	});
});
