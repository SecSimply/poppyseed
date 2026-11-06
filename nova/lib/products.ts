/** What anyone may ask a bank, signed in or not: its published rates and its branches. Fictional. Protea Bank is headquartered in Paarl, South Africa. */

export type Product = "savings" | "mortgage" | "personal_loan";

export interface Rate {
	product: Product;
	name: string;
	/** Annual percentage rate, as a percentage. */
	rate_percent: number;
	/** What the rate is: what savers earn or what borrowers pay. */
	kind: "earned" | "charged";
	minimum_balance?: string;
	term?: string;
	notes: string;
}

export const RATES: Rate[] = [
	{ product: "savings", name: "Protea Saver", rate_percent: 6.5, kind: "earned", minimum_balance: "R10,00", notes: "Variable. Interest is paid monthly. Withdraw any time." },
	{ product: "savings", name: "Protea Fixed Saver, 12 months", rate_percent: 8.1, kind: "earned", minimum_balance: "R5\u00a0000,00", term: "12 months", notes: "Fixed. Early withdrawal forfeits 90 days of interest." },
	{ product: "mortgage", name: "Protea Home Loan, 20 years", rate_percent: 11.25, kind: "charged", term: "20 years", notes: "Linked to the prime lending rate, so it can change. Illustrative; subject to a credit assessment under the National Credit Act." },
	{ product: "personal_loan", name: "Protea Personal Loan", rate_percent: 17.5, kind: "charged", term: "1 to 6 years", notes: "Unsecured, up to R350\u00a0000. Illustrative; subject to a credit assessment under the National Credit Act." },
];

export interface Branch {
	id: string;
	city: string;
	name: string;
	address: string;
	hours: string;
	atm: boolean;
}

export const BRANCHES: Branch[] = [
	{ id: "br_paarl", city: "Paarl", name: "Paarl Head Office", address: "1 Protea Plein, Main Street, Paarl, 7646", hours: "Mon to Fri 9:00 to 15:30, Sat 8:30 to 11:00", atm: true },
	{ id: "br_pretoria", city: "Pretoria", name: "Pretoria Church Square", address: "88 Church Street, Pretoria, 0002", hours: "Mon to Fri 9:00 to 15:30, Sat 8:30 to 11:00", atm: true },
];

export const CITIES = [...new Set(BRANCHES.map((b) => b.city))];
