/**
 * Nova Bank's accounts and transactions. Fictional, held in memory, seeded at startup. A balance is the opening
 * balance plus every transaction, so a payment (phase 3) changes it by adding one.
 */

export interface Money {
	amount: string;
	currency: "USD";
}

export interface Account {
	id: string;
	customerId: string;
	name: string;
	type: "checking" | "savings";
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

/** Dollars for people to read: $1,450.00 and -$5.75. */
export const usd = (cents: number): string => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export const money = (cents: number): Money => ({ amount: (cents / 100).toFixed(2), currency: "USD" });

const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

export const ACCOUNTS: Account[] = [
	{ id: "acc_ada_everyday", customerId: "cus_ada", name: "Everyday Account", type: "checking", endingDigits: "4821", openingCents: 120_000 },
	{ id: "acc_ada_saver", customerId: "cus_ada", name: "Nova Saver", type: "savings", endingDigits: "9034", openingCents: 800_000 },
	{ id: "acc_ben_everyday", customerId: "cus_ben", name: "Everyday Account", type: "checking", endingDigits: "1157", openingCents: 64_000 },
	{ id: "acc_ben_saver", customerId: "cus_ben", name: "Nova Fixed Saver", type: "savings", endingDigits: "7719", openingCents: 1_500_000 },
];

type Seed = [account: string, daysAgo: number, description: string, category: string, cents: number];
const SEED: Seed[] = [
	["acc_ada_everyday", 29, "Brightwater Studio payroll", "income", 172_500],
	["acc_ada_everyday", 27, "Tidewater Energy", "bills", -9_640],
	["acc_ada_everyday", 24, "Meridian Grocers", "groceries", -8_240],
	["acc_ada_everyday", 21, "Harbour Coffee", "eating out", -640],
	["acc_ada_everyday", 18, "Lakeside Transit pass", "transport", -4_500],
	["acc_ada_everyday", 15, "Brightwater Studio payroll", "income", 172_500],
	["acc_ada_everyday", 12, "Summit Books", "shopping", -3_295],
	["acc_ada_everyday", 9, "Meridian Grocers", "groceries", -11_218],
	["acc_ada_everyday", 6, "Fernhill Rent", "housing", -145_000],
	["acc_ada_everyday", 4, "Harbour Coffee", "eating out", -575],
	["acc_ada_everyday", 2, "Northgate Pharmacy", "health", -1_845],
	["acc_ada_everyday", 1, "Brightwater Studio payroll", "income", 172_500],
	["acc_ada_saver", 28, "Transfer from Everyday Account", "transfer", 50_000],
	["acc_ada_saver", 14, "Interest", "interest", 2_599],
	["acc_ada_saver", 3, "Transfer from Everyday Account", "transfer", 50_000],
	["acc_ben_everyday", 26, "Quayside Logistics payroll", "income", 214_000],
	["acc_ben_everyday", 25, "Fernhill Rent", "housing", -168_000],
	["acc_ben_everyday", 20, "Tidewater Energy", "bills", -12_410],
	["acc_ben_everyday", 17, "Summit Books", "shopping", -2_199],
	["acc_ben_everyday", 11, "Meridian Grocers", "groceries", -9_377],
	["acc_ben_everyday", 8, "Lakeside Transit pass", "transport", -4_500],
	["acc_ben_everyday", 5, "Harbour Coffee", "eating out", -830],
	["acc_ben_everyday", 0, "Quayside Logistics payroll", "income", 214_000],
	["acc_ben_saver", 30, "Interest", "interest", 5_750],
	["acc_ben_saver", 0, "Interest", "interest", 5_750],
];

/** What changes while the bank runs: every transaction, and the payments already made. */
interface State {
	transactions: Transaction[];
	applied: Map<string, Moved>;
}

function seeded(): State {
	const counter = new Map<string, number>();
	const transactions = SEED.map(([accountId, daysAgo, description, category, cents]): Transaction => {
		const n = (counter.get(accountId) ?? 0) + 1;
		counter.set(accountId, n);
		return { id: `txn_${accountId.slice(4)}_${n}`, accountId, date: day(daysAgo), description, category, cents };
	});
	return { transactions, applied: new Map() };
}

// One copy per process. A page and an API route can be bundled separately and would otherwise each get their own,
// so a payment made through the API would not show on the page.
declare global {
	var __novaBank: State | undefined;
}
const state = (globalThis.__novaBank ??= seeded());
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

/** A saved payee. An agent can pay these and cannot add one: that is an excluded task (phase 6). */
export interface Payee {
	id: string;
	customerId: string;
	name: string;
	endingDigits: string;
}

export const PAYEES: Payee[] = [
	{ id: "pye_ada_rent", customerId: "cus_ada", name: "Fernhill Rent", endingDigits: "3302" },
	{ id: "pye_ada_energy", customerId: "cus_ada", name: "Tidewater Energy", endingDigits: "7741" },
	{ id: "pye_ada_friend", customerId: "cus_ada", name: "Jamie Quill", endingDigits: "5518" },
	{ id: "pye_ben_rent", customerId: "cus_ben", name: "Fernhill Rent", endingDigits: "3302" },
	{ id: "pye_ben_energy", customerId: "cus_ben", name: "Tidewater Energy", endingDigits: "7741" },
];

export const payeesOf = (customerId: string): Payee[] => PAYEES.filter((p) => p.customerId === customerId);
export const payeeOf = (customerId: string, payeeId: string): Payee | undefined => PAYEES.find((p) => p.id === payeeId && p.customerId === customerId);

/**
 * Up to these amounts an agent may act on a standing permission. Above them the customer must approve each payment
 * themselves, and the bank refuses a confirmation that claims a standing permission.
 */
export const OWN_APPROVAL_OVER_CENTS = { payee: 25_000, transfer: 500_000 } as const;

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
