/**
 * Protea Bank's accounts and transactions. Fictional, in rand, held in memory, seeded at startup. A balance is the opening
 * balance plus every transaction, so a payment (phase 3) changes it by adding one.
 */

export interface Money {
	amount: string;
	currency: "ZAR";
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

/** Rand for people to read, the South African way: R1 450,00 and -R57,50. A non-breaking space groups thousands. */
export const zar = (cents: number): string => {
	const rand = Math.floor(Math.abs(cents) / 100);
	const grouped = String(rand).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
	return `${cents < 0 ? "-" : ""}R${grouped},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
};

export const money = (cents: number): Money => ({ amount: (cents / 100).toFixed(2), currency: "ZAR" });

const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

export const ACCOUNTS: Account[] = [
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

/** A saved payee. An agent can pay these and cannot add one: that is an excluded task (phase 6). */
export interface Payee {
	id: string;
	customerId: string;
	name: string;
	endingDigits: string;
}

const SEED_PAYEES: Payee[] = [
	{ id: "pye_thandi_rent", customerId: "cus_thandi", name: "Dwarsrivier Rentals", endingDigits: "3302" },
	{ id: "pye_thandi_energy", customerId: "cus_thandi", name: "Boland Power", endingDigits: "7741" },
	{ id: "pye_thandi_friend", customerId: "cus_thandi", name: "Sipho Dlamini", endingDigits: "5518" },
	{ id: "pye_pieter_rent", customerId: "cus_pieter", name: "Dwarsrivier Rentals", endingDigits: "3302" },
	{ id: "pye_pieter_energy", customerId: "cus_pieter", name: "Boland Power", endingDigits: "7741" },
];

/** What changes while the bank runs: every transaction, the payments already made, and the saved payees. */
interface State {
	transactions: Transaction[];
	applied: Map<string, Moved>;
	payees: Payee[];
}

function seeded(): State {
	const counter = new Map<string, number>();
	const transactions = SEED.map(([accountId, daysAgo, description, category, cents]): Transaction => {
		const n = (counter.get(accountId) ?? 0) + 1;
		counter.set(accountId, n);
		return { id: `txn_${accountId.slice(4)}_${n}`, accountId, date: day(daysAgo), description, category, cents };
	});
	return { transactions, applied: new Map(), payees: SEED_PAYEES.map((p) => ({ ...p })) };
}

// One copy per process. A page and an API route can be bundled separately and would otherwise each get their own,
// so a payment made through the API would not show on the page.
declare global {
	var __proteaBank: State | undefined;
}
const state = (globalThis.__proteaBank ??= seeded());
export const TRANSACTIONS: Transaction[] = state.transactions;

export const accountsOf = (customerId: string): Account[] => ACCOUNTS.filter((a) => a.customerId === customerId);

/** The account, only if it is this customer's. Another customer's account is the same as none. */
export const accountOf = (customerId: string, accountId: string): Account | undefined => ACCOUNTS.find((a) => a.id === accountId && a.customerId === customerId);

export const balanceCents = (account: Account): number => account.openingCents + TRANSACTIONS.filter((t) => t.accountId === account.id).reduce((sum, t) => sum + t.cents, 0);

export interface TransactionQuery {
	from?: string;
	to?: string;
	limit?: number;
}

/** Newest first. Never includes a balance: reading transactions is a separate permission from reading balances. */
export function transactionsOf(account: Account, { from, to, limit = 20 }: TransactionQuery = {}): Transaction[] {
	return TRANSACTIONS.filter((t) => t.accountId === account.id && (!from || t.date >= from) && (!to || t.date <= to))
		.sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
		.slice(0, limit);
}

// --- payees and payments ---

export const PAYEES: Payee[] = state.payees;

export const MAX_PAYEES = 20;

/**
 * Saves a payee for a customer. Only the customer's own browser may call this: adding a payee is a task Protea Bank
 * does not offer an agent (see excluded.ts), and the page checks who is asking before it gets here.
 */
export function addPayee(customerId: string, name: string, accountNumber: string): { ok: true; payee: Payee } | { ok: false; reason: string } {
	const cleanName = name.trim().replace(/\s+/g, " ");
	if (cleanName.length < 2 || cleanName.length > 60) return { ok: false, reason: "Give the payee a name of 2 to 60 characters." };
	const digits = accountNumber.replace(/[\s-]/g, "");
	if (!/^\d{6,12}$/.test(digits)) return { ok: false, reason: "An account number is 6 to 12 digits." };
	if (payeesOf(customerId).length >= MAX_PAYEES) return { ok: false, reason: `You can save up to ${MAX_PAYEES} payees.` };
	const payee: Payee = { id: `pye_${customerId.slice(4)}_${(state.payees.length + 1).toString(36)}${digits.slice(-3)}`, customerId, name: cleanName, endingDigits: digits.slice(-4) };
	state.payees.push(payee);
	return { ok: true, payee };
}

export const payeesOf = (customerId: string): Payee[] => PAYEES.filter((p) => p.customerId === customerId);
export const payeeOf = (customerId: string, payeeId: string): Payee | undefined => PAYEES.find((p) => p.id === payeeId && p.customerId === customerId);

/**
 * Up to these amounts an agent may act on a standing permission. Above them the customer must approve each payment
 * themselves, and the bank refuses a confirmation that claims a standing permission.
 */
export const OWN_APPROVAL_OVER_CENTS = { payee: 500_000, transfer: 5_000_000 } as const;

/** A decimal amount such as "96.40" as whole cents, or undefined for anything else (no sign, at most two decimals). */
export function parseAmount(text: string): number | undefined {
	const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
	if (!match) return undefined;
	const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
	return cents > 0 ? cents : undefined;
}

export const needsOwnApproval = (kind: keyof typeof OWN_APPROVAL_OVER_CENTS, cents: number): boolean => cents > OWN_APPROVAL_OVER_CENTS[kind];

export type Moved = { ok: true; reference: string } | { ok: false; reason: string };

/**
 * Moves the money, once per operation: the operation id is the idempotency key, so a retry returns the first result
 * and never moves it twice. Checks the funds again, since the balance may have changed since the proposal.
 */
export function movePayment(operationId: string, customerId: string, move: { from: string; description: string; category: string; cents: number; to?: string }): Moved {
	const done = state.applied.get(operationId);
	if (done) return done;
	const from = accountOf(customerId, move.from);
	const to = move.to ? accountOf(customerId, move.to) : undefined;
	let result: Moved;
	if (!from || (move.to && !to)) result = { ok: false, reason: "An account is no longer available. Nothing was moved." };
	else if (balanceCents(from) < move.cents) result = { ok: false, reason: "There is not enough money in the account now. Nothing was moved." };
	else {
		const date = new Date().toISOString().slice(0, 10);
		const reference = `PAY-${operationId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
		TRANSACTIONS.push({ id: `txn_${reference}_out`, accountId: from.id, date, description: move.description, category: move.category, cents: -move.cents });
		if (to) TRANSACTIONS.push({ id: `txn_${reference}_in`, accountId: to.id, date, description: `Transfer from ${from.name} ••${from.endingDigits}`, category: "transfer", cents: move.cents });
		result = { ok: true, reference };
	}
	state.applied.set(operationId, result);
	return result;
}
