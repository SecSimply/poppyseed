/**
 * Protea Bank's customers, accounts, transactions and payees. Fictional, in rand. In Postgres when DATABASE_URL is set,
 * in memory otherwise (local development and tests). A balance is the opening balance plus every transaction, so a
 * payment changes it by adding one. Every function is asynchronous, because the real store is a database.
 */
import { randomBytes, randomInt } from "node:crypto";
import { database } from "./db.ts";

export interface Money {
	amount: string;
	currency: "ZAR";
}

export interface Customer {
	id: string;
	name: string;
	email: string;
}

export interface Account {
	id: string;
	customerId: string;
	name: string;
	type: "cheque" | "savings";
	/** The last four digits, the only part ever shown. */
	endingDigits: string;
	openingCents: number;
}

export interface Transaction {
	id: string;
	accountId: string;
	/** YYYY-MM-DD. */
	date: string;
	description: string;
	category: string;
	/** Signed: money in is positive, money out is negative. */
	cents: number;
}

/** A saved payee. An agent can pay these and cannot add one: that is an excluded task (phase 6). */
export interface Payee {
	id: string;
	customerId: string;
	name: string;
	endingDigits: string;
}

/** Rand for people to read, the South African way: R1 450,00 and -R57,50. A non-breaking space groups thousands. */
export const zar = (cents: number): string => {
	const rand = Math.floor(Math.abs(cents) / 100);
	const grouped = String(rand).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
	return `${cents < 0 ? "-" : ""}R${grouped},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
};

export const money = (cents: number): Money => ({ amount: (cents / 100).toFixed(2), currency: "ZAR" });

export interface TransactionQuery {
	from?: string;
	to?: string;
	limit?: number;
}

export type Moved = { ok: true; reference: string } | { ok: false; reason: string };
type Refused = { ok: false; reason: string };
export type Added = { ok: true; payee: Payee } | { ok: false; reason: string };
export type Created = { ok: true; customer: Customer; accounts: Account[] } | { ok: false; reason: string };

export interface Move {
	from: string;
	description: string;
	category: string;
	cents: number;
	to?: string;
}

/** Everything the bank knows. A customer's data is only ever asked for by that customer's id, so another customer's is the same as none. */
export interface Bank {
	customers(): Promise<Customer[]>;
	customer(id: string | undefined): Promise<Customer | undefined>;
	/** Staff open a customer for a person: the customer, with an everyday and a savings account that start with sandbox money. */
	createCustomer(input: { name: string; email: string }): Promise<Created>;
	accountsOf(customerId: string): Promise<Account[]>;
	/** The same accounts with their balances, in one read. */
	balancesOf(customerId: string): Promise<(Account & { balanceCents: number })[]>;
	/** The account, only if it is this customer's. Another customer's account is the same as none. */
	accountOf(customerId: string, accountId: string): Promise<Account | undefined>;
	balanceCents(account: Account): Promise<number>;
	/** Newest first. Never includes a balance: reading transactions is a separate permission from reading balances. */
	transactionsOf(account: Account, query?: TransactionQuery): Promise<Transaction[]>;
	/** The customer's payments and transfers across all their accounts, newest first. */
	paymentsOf(customerId: string, limit: number): Promise<Transaction[]>;
	payeesOf(customerId: string): Promise<Payee[]>;
	payeeOf(customerId: string, payeeId: string): Promise<Payee | undefined>;
	/**
	 * Saves a payee for a customer. Only the customer's own browser may call this: adding a payee is a task Protea Bank
	 * does not offer an agent (see excluded.ts), and the page checks who is asking before it gets here.
	 */
	addPayee(customerId: string, name: string, accountNumber: string): Promise<Added>;
	/**
	 * Moves the money, once per operation: the operation id is the idempotency key, so a retry returns the first result
	 * and never moves it twice. Checks the funds again, since the balance may have changed since the proposal.
	 */
	movePayment(operationId: string, customerId: string, move: Move): Promise<Moved>;
}

// --- what is the same in every store ---

export const MAX_PAYEES = 20;

/**
 * Up to these amounts an agent may act on a standing permission. Above them the customer must approve each payment
 * themselves, and the bank refuses a confirmation that claims a standing permission.
 */
export const OWN_APPROVAL_OVER_CENTS = { payee: 50_000, transfer: 500_000 } as const;

/** A decimal amount such as "96.40" as whole cents, or undefined for anything else (no sign, at most two decimals). */
export function parseAmount(text: string): number | undefined {
	const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
	if (!match) return undefined;
	const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
	return cents > 0 ? cents : undefined;
}

export const needsOwnApproval = (kind: keyof typeof OWN_APPROVAL_OVER_CENTS, cents: number): boolean => cents > OWN_APPROVAL_OVER_CENTS[kind];

/** A payee's name and account number, cleaned, or why they are not acceptable. */
export function checkPayee(name: string, accountNumber: string): { ok: true; name: string; digits: string } | { ok: false; reason: string } {
	const cleanName = name.trim().replace(/\s+/g, " ");
	if (cleanName.length < 2 || cleanName.length > 60) return { ok: false, reason: "Give the payee a name of 2 to 60 characters." };
	const digits = accountNumber.replace(/[\s-]/g, "");
	if (!/^\d{6,12}$/.test(digits)) return { ok: false, reason: "An account number is 6 to 12 digits." };
	return { ok: true, name: cleanName, digits };
}

/** A new customer's name and email, cleaned, or why they are not acceptable. */
export function checkNewCustomer(name: string, email: string): { ok: true; name: string; email: string } | { ok: false; reason: string } {
	const cleanName = name.trim().replace(/\s+/g, " ");
	if (cleanName.length < 2 || cleanName.length > 60) return { ok: false, reason: "Give the customer a name of 2 to 60 characters." };
	const cleanEmail = email.trim().toLowerCase();
	if (cleanEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, reason: "Give the customer an email address." };
	return { ok: true, name: cleanName, email: cleanEmail };
}

const randomId = (prefix: string): string => `${prefix}_${randomBytes(5).toString("hex")}`;
export const newCustomerId = (): string => randomId("cus");
export const newPayeeId = (customerId: string): string => `pye_${customerId.slice(4)}_${randomBytes(4).toString("hex")}`;

/** What a new customer starts with: an everyday cheque account and a saver, with sandbox money. It is a demonstration; the money is not real. */
export function openingAccounts(customerId: string): Account[] {
	const key = customerId.slice(4);
	const digits = () => String(randomInt(1000, 10000));
	return [
		{ id: `acc_${key}_everyday`, customerId, name: "Everyday Cheque Account", type: "cheque", endingDigits: digits(), openingCents: 1_500_000 },
		{ id: `acc_${key}_saver`, customerId, name: "Protea Saver", type: "savings", endingDigits: digits(), openingCents: 500_000 },
	];
}

/** The reference a payment gets, from its operation id, so a retry gets the same one. */
export const paymentReference = (operationId: string): string => `PAY-${operationId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;

export const NOT_AVAILABLE: Refused = { ok: false, reason: "An account is no longer available. Nothing was moved." };
export const NOT_ENOUGH: Refused = { ok: false, reason: "There is not enough money in the account now. Nothing was moved." };

declare global {
	var __proteaPerformed: Map<string, unknown[]> | undefined;
	var __proteaBank: Bank | undefined;
}

/** The terms each run of a payment's `perform` got, per operation, for the conformance suite's `performed` hook. Newest 200 operations. */
const performedLog = (globalThis.__proteaPerformed ??= new Map<string, unknown[]>());
export function recordPerformed(operationId: string, terms: unknown): void {
	performedLog.set(operationId, [...(performedLog.get(operationId) ?? []), terms]);
	for (const old of [...performedLog.keys()].slice(0, Math.max(0, performedLog.size - 200))) performedLog.delete(old);
}
export const performedTerms = (operationId: string): unknown[] => performedLog.get(operationId) ?? [];

// --- the two demonstration customers every store starts with ---

export const SEED_CUSTOMERS: Customer[] = [
	{ id: "cus_thandi", name: "Thandi Nkosi", email: "thandi@proteabank.example" },
	{ id: "cus_pieter", name: "Pieter van Wyk", email: "pieter@proteabank.example" },
];

export const SEED_ACCOUNTS: Account[] = [
	{ id: "acc_thandi_everyday", customerId: "cus_thandi", name: "Everyday Cheque Account", type: "cheque", endingDigits: "4821", openingCents: 2_200_000 },
	{ id: "acc_thandi_saver", customerId: "cus_thandi", name: "Protea Saver", type: "savings", endingDigits: "9034", openingCents: 15_000_000 },
	{ id: "acc_pieter_everyday", customerId: "cus_pieter", name: "Everyday Cheque Account", type: "cheque", endingDigits: "1157", openingCents: 1_200_000 },
	{ id: "acc_pieter_saver", customerId: "cus_pieter", name: "Protea Fixed Saver", type: "savings", endingDigits: "7719", openingCents: 28_000_000 },
];

type Seed = [account: string, daysAgo: number, description: string, category: string, cents: number];
const SEED: Seed[] = [
	["acc_thandi_everyday", 29, "Fynbos Digital payroll", "income", 3_250_000],
	["acc_thandi_everyday", 27, "Boland Power", "bills", -173_500],
	["acc_thandi_everyday", 24, "Karoo Fresh", "groceries", -148_250],
	["acc_thandi_everyday", 21, "Rooibos & Co Café", "eating out", -6_400],
	["acc_thandi_everyday", 18, "Cape Metro rail pass", "transport", -89_000],
	["acc_thandi_everyday", 15, "Fynbos Digital payroll", "income", 3_250_000],
	["acc_thandi_everyday", 12, "Lekker Books", "shopping", -45_900],
	["acc_thandi_everyday", 9, "Karoo Fresh", "groceries", -210_635],
	["acc_thandi_everyday", 6, "Dwarsrivier Rentals", "housing", -1_450_000],
	["acc_thandi_everyday", 4, "Rooibos & Co Café", "eating out", -5_800],
	["acc_thandi_everyday", 2, "Paarl Pharmacy", "health", -31_280],
	["acc_thandi_everyday", 1, "Fynbos Digital payroll", "income", 3_250_000],
	["acc_thandi_saver", 28, "Transfer from Everyday Cheque Account", "transfer", 500_000],
	["acc_thandi_saver", 14, "Interest", "interest", 51_240],
	["acc_thandi_saver", 3, "Transfer from Everyday Cheque Account", "transfer", 500_000],
	["acc_pieter_everyday", 26, "Overberg Freight payroll", "income", 3_800_000],
	["acc_pieter_everyday", 25, "Dwarsrivier Rentals", "housing", -1_680_000],
	["acc_pieter_everyday", 20, "Boland Power", "bills", -224_000],
	["acc_pieter_everyday", 17, "Lekker Books", "shopping", -38_900],
	["acc_pieter_everyday", 11, "Karoo Fresh", "groceries", -173_590],
	["acc_pieter_everyday", 8, "Cape Metro rail pass", "transport", -89_000],
	["acc_pieter_everyday", 5, "Rooibos & Co Café", "eating out", -7_200],
	["acc_pieter_everyday", 0, "Overberg Freight payroll", "income", 3_800_000],
	["acc_pieter_saver", 30, "Interest", "interest", 215_000],
	["acc_pieter_saver", 0, "Interest", "interest", 215_000],
];

const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** The demonstration customers' history, dated from now. */
export function seedTransactions(): Transaction[] {
	const counter = new Map<string, number>();
	return SEED.map(([accountId, daysAgo, description, category, cents]): Transaction => {
		const n = (counter.get(accountId) ?? 0) + 1;
		counter.set(accountId, n);
		return { id: `txn_${accountId.slice(4)}_${n}`, accountId, date: day(daysAgo), description, category, cents };
	});
}

export const SEED_PAYEES: Payee[] = [
	{ id: "pye_thandi_rent", customerId: "cus_thandi", name: "Dwarsrivier Rentals", endingDigits: "3302" },
	{ id: "pye_thandi_energy", customerId: "cus_thandi", name: "Boland Power", endingDigits: "7741" },
	{ id: "pye_thandi_friend", customerId: "cus_thandi", name: "Sipho Dlamini", endingDigits: "5518" },
	{ id: "pye_pieter_rent", customerId: "cus_pieter", name: "Dwarsrivier Rentals", endingDigits: "3302" },
	{ id: "pye_pieter_energy", customerId: "cus_pieter", name: "Boland Power", endingDigits: "7741" },
];

/** Newest first; the id breaks a tie on the date. */
const newestFirst = (a: Transaction, b: Transaction): number => (a.date === b.date ? (a.id < b.id ? 1 : -1) : b.date.localeCompare(a.date));

// --- in memory ---

/** A bank held in memory, seeded with the two demonstration customers. Local development, the conformance suite and tests. */
export function memoryBank(): Bank {
	const customers: Customer[] = SEED_CUSTOMERS.map((c) => ({ ...c }));
	const accounts: Account[] = SEED_ACCOUNTS.map((a) => ({ ...a }));
	const transactions: Transaction[] = seedTransactions();
	const payees: Payee[] = SEED_PAYEES.map((p) => ({ ...p }));
	const applied = new Map<string, Moved>();

	// Synchronous inside, so that a payment's check and debit cannot be interleaved with another's: there is no await between them.
	const ownAccount = (customerId: string, accountId: string) => accounts.find((a) => a.id === accountId && a.customerId === customerId);
	const balance = (account: Account) => account.openingCents + transactions.filter((t) => t.accountId === account.id).reduce((sum, t) => sum + t.cents, 0);
	const accountsOf = async (customerId: string) => accounts.filter((a) => a.customerId === customerId);
	const payeesOf = async (customerId: string) => payees.filter((p) => p.customerId === customerId);

	return {
		customers: async () => customers.map((c) => ({ ...c })),
		customer: async (id) => customers.find((c) => c.id === id),
		async createCustomer(input) {
			const checked = checkNewCustomer(input.name, input.email);
			if (!checked.ok) return checked;
			const customer: Customer = { id: newCustomerId(), name: checked.name, email: checked.email };
			const opened = openingAccounts(customer.id);
			customers.push(customer);
			accounts.push(...opened);
			return { ok: true, customer, accounts: opened };
		},
		accountsOf,
		async balancesOf(customerId) {
			return (await accountsOf(customerId)).map((a) => ({ ...a, balanceCents: balance(a) }));
		},
		accountOf: async (customerId, accountId) => ownAccount(customerId, accountId),
		balanceCents: async (account) => balance(account),
		async transactionsOf(account, { from, to, limit = 20 } = {}) {
			return transactions.filter((t) => t.accountId === account.id && (!from || t.date >= from) && (!to || t.date <= to)).sort(newestFirst).slice(0, limit);
		},
		async paymentsOf(customerId, limit) {
			const mine = new Set((await accountsOf(customerId)).map((a) => a.id));
			return transactions.filter((t) => (t.category === "payment" || t.category === "transfer") && mine.has(t.accountId)).sort(newestFirst).slice(0, limit);
		},
		payeesOf,
		payeeOf: async (customerId, payeeId) => payees.find((p) => p.id === payeeId && p.customerId === customerId),
		async addPayee(customerId, name, accountNumber) {
			const checked = checkPayee(name, accountNumber);
			if (!checked.ok) return checked;
			if ((await payeesOf(customerId)).length >= MAX_PAYEES) return { ok: false, reason: `You can save up to ${MAX_PAYEES} payees.` };
			const payee: Payee = { id: newPayeeId(customerId), customerId, name: checked.name, endingDigits: checked.digits.slice(-4) };
			payees.push(payee);
			return { ok: true, payee };
		},
		async movePayment(operationId, customerId, move) {
			const done = applied.get(operationId);
			if (done) return done;
			const from = ownAccount(customerId, move.from);
			const to = move.to ? ownAccount(customerId, move.to) : undefined;
			let result: Moved;
			if (!from || (move.to && !to)) result = NOT_AVAILABLE;
			else if (balance(from) < move.cents) result = NOT_ENOUGH;
			else {
				const date = new Date().toISOString().slice(0, 10);
				const reference = paymentReference(operationId);
				transactions.push({ id: `txn_${reference}_out`, accountId: from.id, date, description: move.description, category: move.category, cents: -move.cents });
				if (to) transactions.push({ id: `txn_${reference}_in`, accountId: to.id, date, description: `Transfer from ${from.name} ••${from.endingDigits}`, category: "transfer", cents: move.cents });
				result = { ok: true, reference };
			}
			applied.set(operationId, result);
			return result;
		},
	};
}

/**
 * The bank in use. In production Postgres is required: without it every customer, balance and payment would vanish on
 * a restart, so the first use fails loudly instead. One copy per process: a page and an API route can be bundled
 * separately and would otherwise each get their own, so a payment made through the API would not show on the page.
 */
export async function bank(env: Record<string, string | undefined> = process.env): Promise<Bank> {
	if (globalThis.__proteaBank) return globalThis.__proteaBank;
	const db = await database(env);
	if (db) return (globalThis.__proteaBank = (await import("./bank-sql.ts")).postgresBank(db));
	if (env.NODE_ENV === "production") throw new Error("DATABASE_URL is not set: Protea Bank has nowhere to keep its customers and accounts");
	return (globalThis.__proteaBank = memoryBank());
}
