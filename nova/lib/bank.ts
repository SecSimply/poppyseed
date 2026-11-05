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

const counter = new Map<string, number>();
export const TRANSACTIONS: Transaction[] = SEED.map(([accountId, daysAgo, description, category, cents]) => {
	const n = (counter.get(accountId) ?? 0) + 1;
	counter.set(accountId, n);
	return { id: `txn_${accountId.slice(4)}_${n}`, accountId, date: day(daysAgo), description, category, cents };
});

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
