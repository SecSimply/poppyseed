/** One contract, run against both stores. Postgres runs on PGlite. */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { memoryBank, money, MAX_PAYEES, needsOwnApproval, parseAmount, zar, type Bank } from "./bank.ts";
import { postgresBank } from "./bank-sql.ts";

// One database for the file, emptied before each test: starting PGlite is slow. The tables are fixed names.
const shared = (async () => { const db = new PGlite(); await db.waitReady; return db; })();
const stores: [string, () => Promise<Bank>][] = [
	["memory", async () => memoryBank()],
	["postgres", async () => { const db = await shared; await db.exec("drop table if exists nova_payments, nova_payees, nova_transactions, nova_accounts, nova_customers cascade"); return postgresBank(db); }],
];

describe.each(stores)("%s bank", (_name, make) => {
	describe("customers", () => {
		it("starts with the two demonstration customers", async () => {
			const bank = await make();
			expect((await bank.customers()).map((c) => c.id).sort()).toEqual(["cus_pieter", "cus_thandi"]);
			expect(await bank.customer("cus_thandi")).toMatchObject({ name: "Thandi Nkosi" });
			expect(await bank.customer("cus_nobody")).toBeUndefined();
			expect(await bank.customer(undefined)).toBeUndefined();
		});

		it("opens a new customer with an everyday account and a saver of their own, with sandbox money", async () => {
			const bank = await make();
			const made = await bank.createCustomer({ name: "  Lerato   Mokoena ", email: " Lerato@Example.com " });
			if (!made.ok) throw new Error(made.reason);
			expect(made.customer).toMatchObject({ name: "Lerato Mokoena", email: "lerato@example.com" });
			expect(await bank.customer(made.customer.id)).toEqual(made.customer);
			const accounts = await bank.balancesOf(made.customer.id);
			expect(accounts.map((a) => [a.type, a.balanceCents])).toEqual([["cheque", 1_500_000], ["savings", 500_000]]);
			expect(accounts.every((a) => a.customerId === made.customer.id)).toBe(true);
			// Another customer's accounts are untouched, and the new customer sees none of theirs.
			expect((await bank.accountsOf("cus_thandi")).length).toBe(2);
			expect(await bank.accountOf(made.customer.id, "acc_thandi_saver")).toBeUndefined();
			expect(await bank.payeesOf(made.customer.id)).toEqual([]);
			expect(await bank.paymentsOf(made.customer.id, 10)).toEqual([]);
			expect((await bank.customers()).length).toBe(3);
		});

		it("gives two customers with the same name different ids and accounts", async () => {
			const bank = await make();
			const a = await bank.createCustomer({ name: "Same Name", email: "a@example.com" });
			const b = await bank.createCustomer({ name: "Same Name", email: "b@example.com" });
			if (!a.ok || !b.ok) throw new Error("not created");
			expect(a.customer.id).not.toBe(b.customer.id);
			expect(new Set([...a.accounts, ...b.accounts].map((x) => x.id)).size).toBe(4);
		});

		it("refuses a bad name or email", async () => {
			const bank = await make();
			expect((await bank.createCustomer({ name: "A", email: "a@example.com" })).ok).toBe(false);
			expect((await bank.createCustomer({ name: "Fine Name", email: "not an email" })).ok).toBe(false);
			expect((await bank.createCustomer({ name: "Fine Name", email: "" })).ok).toBe(false);
			expect((await bank.customers()).length).toBe(2);
		});
	});

	describe("ownership", () => {
		it("gives a customer only their own accounts", async () => {
			const bank = await make();
			const mine = await bank.accountsOf("cus_thandi");
			expect(mine.length).toBeGreaterThan(0);
			expect(mine.every((a) => a.customerId === "cus_thandi")).toBe(true);
			expect(await bank.accountsOf("cus_nobody")).toEqual([]);
		});

		it("treats another customer's account as if it did not exist", async () => {
			const bank = await make();
			expect(await bank.accountOf("cus_thandi", "acc_thandi_saver")).toBeDefined();
			expect(await bank.accountOf("cus_thandi", "acc_pieter_everyday")).toBeUndefined();
			expect(await bank.accountOf("cus_pieter", "acc_thandi_saver")).toBeUndefined();
		});
	});

	describe("balances and transactions", () => {
		it("computes a balance from the opening balance and every transaction", async () => {
			const bank = await make();
			const account = (await bank.accountOf("cus_thandi", "acc_thandi_saver"))!;
			const all = await bank.transactionsOf(account, { limit: 100 });
			expect(await bank.balanceCents(account)).toBe(account.openingCents + all.reduce((sum, t) => sum + t.cents, 0));
			expect((await bank.balancesOf("cus_thandi")).find((a) => a.id === account.id)?.balanceCents).toBe(await bank.balanceCents(account));
		});

		it("lists transactions newest first, within a date range and a limit, and only for that account", async () => {
			const bank = await make();
			const account = (await bank.accountOf("cus_thandi", "acc_thandi_everyday"))!;
			const all = await bank.transactionsOf(account, { limit: 100 });
			expect(all.every((t) => t.accountId === account.id)).toBe(true);
			expect([...all].sort((a, b) => b.date.localeCompare(a.date))).toEqual(all);
			expect(await bank.transactionsOf(account, { limit: 3 })).toHaveLength(3);
			const middle = all[5]!.date;
			expect((await bank.transactionsOf(account, { from: middle, limit: 100 })).every((t) => t.date >= middle)).toBe(true);
			expect((await bank.transactionsOf(account, { to: middle, limit: 100 })).every((t) => t.date <= middle)).toBe(true);
		});

		it("never carries a balance on a transaction", async () => {
			const bank = await make();
			const account = (await bank.accountOf("cus_thandi", "acc_thandi_everyday"))!;
			for (const t of await bank.transactionsOf(account)) expect(Object.keys(t)).not.toContain("balance");
		});
	});

	describe("payees", () => {
		it("are a customer's own, and another's look like none", async () => {
			const bank = await make();
			expect((await bank.payeesOf("cus_thandi")).every((p) => p.customerId === "cus_thandi")).toBe(true);
			expect(await bank.payeeOf("cus_thandi", "pye_thandi_rent")).toBeDefined();
			expect(await bank.payeeOf("cus_thandi", "pye_pieter_rent")).toBeUndefined();
		});

		it("are saved for that customer only, showing the last four digits", async () => {
			const bank = await make();
			const added = await bank.addPayee("cus_pieter", "  Karoo   Gym ", "1234 5678-90");
			expect(added.ok && added.payee).toMatchObject({ customerId: "cus_pieter", name: "Karoo Gym", endingDigits: "7890" });
			expect((await bank.payeesOf("cus_pieter")).some((p) => p.name === "Karoo Gym")).toBe(true);
			expect((await bank.payeesOf("cus_thandi")).some((p) => p.name === "Karoo Gym")).toBe(false);
		});

		it("refuse a bad name or account number", async () => {
			const bank = await make();
			expect((await bank.addPayee("cus_thandi", "A", "123456")).ok).toBe(false);
			expect((await bank.addPayee("cus_thandi", "Fine Name", "12ab56")).ok).toBe(false);
			expect((await bank.addPayee("cus_thandi", "Fine Name", "12345")).ok).toBe(false);
		});

		it("stop at the limit", async () => {
			const bank = await make();
			for (let i = 0; (await bank.payeesOf("cus_thandi")).length < MAX_PAYEES; i++) await bank.addPayee("cus_thandi", `Payee ${i}`, `10000${i}`);
			expect((await bank.addPayee("cus_thandi", "One more", "999999")).ok).toBe(false);
		});
	});

	describe("movePayment", () => {
		const everyday = async (bank: Bank) => (await bank.accountOf("cus_thandi", "acc_thandi_everyday"))!;

		it("moves the money once, however many times the same operation runs", async () => {
			const bank = await make();
			const before = await bank.balanceCents(await everyday(bank));
			const move = { from: "acc_thandi_everyday", description: "Boland Power", category: "payment", cents: 9_640 };
			const first = await bank.movePayment("op_once", "cus_thandi", move);
			const again = await bank.movePayment("op_once", "cus_thandi", move);
			expect(first.ok).toBe(true);
			expect(again).toEqual(first);
			expect(await bank.balanceCents(await everyday(bank))).toBe(before - 9_640);
			expect((await bank.paymentsOf("cus_thandi", 10)).filter((t) => t.description === "Boland Power" && t.cents === -9_640)).toHaveLength(1);
		});

		it("answers a retry with the first answer, even when the money is gone by then", async () => {
			const bank = await make();
			const all = await bank.balanceCents(await everyday(bank));
			const move = { from: "acc_thandi_everyday", description: "Everything", category: "payment", cents: all };
			const first = await bank.movePayment("op_all", "cus_thandi", move);
			expect(first.ok).toBe(true);
			expect(await bank.movePayment("op_all", "cus_thandi", move)).toEqual(first);
			expect(await bank.balanceCents(await everyday(bank))).toBe(0);
		});

		it("runs two concurrent copies of one operation once", async () => {
			const bank = await make();
			const before = await bank.balanceCents(await everyday(bank));
			const move = { from: "acc_thandi_everyday", description: "Race", category: "payment", cents: 1_000 };
			const results = await Promise.all([bank.movePayment("op_race", "cus_thandi", move), bank.movePayment("op_race", "cus_thandi", move)]);
			expect(results[0]).toEqual(results[1]);
			expect(await bank.balanceCents(await everyday(bank))).toBe(before - 1_000);
		});

		it("keeps the total the same when moving between a customer's own accounts", async () => {
			const bank = await make();
			const total = async () => (await bank.balancesOf("cus_thandi")).reduce((sum, a) => sum + a.balanceCents, 0);
			const before = await total();
			const moved = await bank.movePayment("op_xfer", "cus_thandi", { from: "acc_thandi_everyday", to: "acc_thandi_saver", description: "Transfer to Protea Saver", category: "transfer", cents: 10_000 });
			expect(moved.ok).toBe(true);
			expect(await total()).toBe(before);
			// The demonstration history already holds two transfers of R5 000; this one is R100.
			const mine = (await bank.paymentsOf("cus_thandi", 10)).filter((t) => Math.abs(t.cents) === 10_000);
			expect(mine.map((t) => t.cents).sort((a, b) => a - b)).toEqual([-10_000, 10_000]);
		});

		it("refuses to overspend, and remembers the refusal", async () => {
			const bank = await make();
			const before = await bank.balanceCents(await everyday(bank));
			const result = await bank.movePayment("op_poor", "cus_thandi", { from: "acc_thandi_everyday", description: "Too much", category: "payment", cents: before + 1 });
			expect(result.ok).toBe(false);
			expect(await bank.balanceCents(await everyday(bank))).toBe(before);
			expect(await bank.movePayment("op_poor", "cus_thandi", { from: "acc_thandi_everyday", description: "Too much", category: "payment", cents: 1 })).toEqual(result);
		});

		it("lets two payments spend no more than the balance between them", async () => {
			const bank = await make();
			const balance = await bank.balanceCents(await everyday(bank));
			const pay = (id: string) => bank.movePayment(id, "cus_thandi", { from: "acc_thandi_everyday", description: id, category: "payment", cents: balance - 100 });
			const results = await Promise.all([pay("op_a"), pay("op_b")]);
			expect(results.filter((r) => r.ok)).toHaveLength(1);
			expect(await bank.balanceCents(await everyday(bank))).toBe(100);
		});

		it("never moves money out of, or into, another customer's account", async () => {
			const bank = await make();
			const ben = (await bank.accountOf("cus_pieter", "acc_pieter_everyday"))!;
			const before = await bank.balanceCents(ben);
			expect((await bank.movePayment("op_theft", "cus_thandi", { from: "acc_pieter_everyday", description: "x", category: "payment", cents: 100 })).ok).toBe(false);
			expect((await bank.movePayment("op_theft2", "cus_thandi", { from: "acc_thandi_everyday", to: "acc_pieter_everyday", description: "x", category: "transfer", cents: 100 })).ok).toBe(false);
			expect(await bank.balanceCents(ben)).toBe(before);
		});

		it("works for a customer opened after the bank started", async () => {
			const bank = await make();
			const made = await bank.createCustomer({ name: "Lerato Mokoena", email: "lerato@example.com" });
			if (!made.ok) throw new Error(made.reason);
			const [cheque, saver] = made.accounts;
			const moved = await bank.movePayment("op_new", made.customer.id, { from: cheque!.id, to: saver!.id, description: "Transfer to saver", category: "transfer", cents: 250_000 });
			expect(moved.ok).toBe(true);
			expect((await bank.balancesOf(made.customer.id)).map((a) => a.balanceCents)).toEqual([1_250_000, 750_000]);
		});
	});
});

describe("postgres bank", () => {
	it("keeps what it was given across a restart, and seeds the demonstration customers only once", async () => {
		const db = await shared;
		await db.exec("drop table if exists nova_payments, nova_payees, nova_transactions, nova_accounts, nova_customers cascade");
		const first = postgresBank(db);
		const made = await first.createCustomer({ name: "Lerato Mokoena", email: "lerato@example.com" });
		if (!made.ok) throw new Error(made.reason);
		await first.movePayment("op_keep", "cus_thandi", { from: "acc_thandi_everyday", description: "Kept", category: "payment", cents: 5_000 });
		// A second instance on the same database is a restarted process.
		const second = postgresBank(db);
		expect((await second.customers()).map((c) => c.id).sort()).toEqual(["cus_pieter", "cus_thandi", made.customer.id].sort());
		expect((await second.paymentsOf("cus_thandi", 10)).map((t) => t.description)).toContain("Kept");
		expect((await second.accountsOf("cus_thandi")).length).toBe(2);
		expect((await second.transactionsOf((await second.accountOf("cus_thandi", "acc_thandi_saver"))!, { limit: 100 })).length).toBe(3);
	});
});

describe("rand", () => {
	it("writes rand the South African way: R, a space between thousands, a comma before the cents", () => {
		expect(zar(9_640)).toBe("R96,40");
		expect(zar(145_000)).toBe("R1 450,00");
		expect(zar(123_456_789)).toBe("R1 234 567,89");
		expect(zar(-575)).toBe("-R5,75");
		expect(zar(5)).toBe("R0,05");
	});

	it("formats money with two decimals, negatives included", () => {
		expect(money(172_500)).toEqual({ amount: "1725.00", currency: "ZAR" });
		expect(money(-575)).toEqual({ amount: "-5.75", currency: "ZAR" });
		expect(money(5)).toEqual({ amount: "0.05", currency: "ZAR" });
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
		expect(needsOwnApproval("payee", 500_000)).toBe(false);
		expect(needsOwnApproval("payee", 500_001)).toBe(true);
		expect(needsOwnApproval("transfer", 5_000_000)).toBe(false);
		expect(needsOwnApproval("transfer", 5_000_001)).toBe(true);
	});
});
