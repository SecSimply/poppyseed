/** What anyone may ask a bank, signed in or not: its published rates and its branches. Fictional. */

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
	{ product: "savings", name: "Nova Saver", rate_percent: 3.9, kind: "earned", minimum_balance: "$1.00", notes: "Variable. Interest is paid monthly. Withdraw any time." },
	{ product: "savings", name: "Nova Fixed Saver, 12 months", rate_percent: 4.6, kind: "earned", minimum_balance: "$500.00", term: "12 months", notes: "Fixed. Early withdrawal forfeits 90 days of interest." },
	{ product: "mortgage", name: "Nova Home Loan, 30 years", rate_percent: 6.4, kind: "charged", term: "30 years", notes: "Fixed for the first 5 years, then variable. Illustrative; subject to credit approval." },
	{ product: "personal_loan", name: "Nova Personal Loan", rate_percent: 9.9, kind: "charged", term: "1 to 7 years", notes: "Unsecured, up to $40,000. Illustrative; subject to credit approval." },
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
	{ id: "br_harbour", city: "Port Meridian", name: "Harbour Street", address: "14 Harbour Street, Port Meridian", hours: "Mon to Fri 9:00 to 17:00, Sat 9:00 to 13:00", atm: true },
	{ id: "br_northgate", city: "Port Meridian", name: "Northgate", address: "220 Northgate Road, Port Meridian", hours: "Mon to Fri 9:00 to 17:00", atm: true },
	{ id: "br_lakeside", city: "Lakeside", name: "Lakeside Square", address: "3 Lakeside Square, Lakeside", hours: "Mon to Fri 9:30 to 16:30", atm: false },
	{ id: "br_summit", city: "Summit Falls", name: "Summit Falls", address: "88 Main Street, Summit Falls", hours: "Mon to Sat 9:00 to 15:00", atm: true },
];

export const CITIES = [...new Set(BRANCHES.map((b) => b.city))];
