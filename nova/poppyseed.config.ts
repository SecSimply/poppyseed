import { definePoppyseed, memoryStore, safeFetch, tool, ToolError } from "poppyseed";
import { after } from "next/server";
import { z } from "zod";
import { accountOf, accountsOf, balanceCents, money, transactionsOf } from "./lib/bank.ts";
import { SITE_COOKIE, siteCustomer } from "./lib/customers.ts";
import { BRANCHES, CITIES, RATES } from "./lib/products.ts";

const isDev = process.env.NODE_ENV !== "production";
const allowLoopback = isDev || process.env.POPPYSEED_ALLOW_LOOPBACK_AGENTS === "1";
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const baseUrl = process.env.POPPYSEED_BASE_URL ?? (isDev || isBuild ? "http://localhost:3000" : undefined);
if (!baseUrl) throw new Error("Set POPPYSEED_BASE_URL to the public origin in production");
const secret = process.env.POPPYSEED_SECRET ?? (isDev || isBuild ? "dev-only-secret-change-me-in-production!!" : undefined);
if (!secret) throw new Error("Set POPPYSEED_SECRET (32+ characters) in production");

export const poppyseed = definePoppyseed({
	organization: { name: "Nova Bank", domain: new URL(baseUrl).hostname },
	baseUrl,
	secret,
	// One long-lived server process. On serverless or several instances, use postgresStore(pool) so state is shared.
	store: memoryStore(),
	// Keeps slow work running after the response.
	waitUntil: (promise) => {
		try {
			after(promise);
		} catch {
			// Called outside a request; the server keeps running anyway.
		}
	},
	apiDescription: "Published rates and branches, and, with your sign-in, your accounts, transactions and payments",

	// What Personal Agents can ask for, in words a customer and a model both understand.
	scopes: {
		"accounts:read": "See your accounts and balances. It doesn't show transactions and can't move money.",
		"transactions:read": "See the transactions on your accounts. It doesn't show balances and can't move money.",
		"payments:write": "Propose payments and transfers from your accounts. Larger ones, and any to a new payee, still need you to approve them yourself.",
	},
	// How consequential each scope is, so a personal agent can ask before requesting it.
	scopeHints: {
		"accounts:read": { changes: "none", personalData: true },
		"transactions:read": { changes: "none", personalData: true },
		"payments:write": { changes: "irreversible", personalData: true },
	},

	// Who is signed in to Nova Bank itself, so consent pages know whose accounts they connect.
	accounts: {
		current: (request) => {
			const customer = siteCustomer(request.headers.get("cookie"));
			return customer ? { id: customer.id, label: customer.email } : null;
		},
		signInUrl: (returnTo) => `/login?return_to=${encodeURIComponent(returnTo)}`,
	},
	// Direct and Device Sign-In only. Mediated Sign-In has an agent type the customer's password, which a bank should not teach.
	signIn: { direct: true, device: true },

	// Local agents (npx poppyseed agent) serve their metadata over http://127.0.0.1.
	dev: { allowInsecureClients: allowLoopback },
	fetch: (input, init) => (allowLoopback ? fetch(input, init) : safeFetch(input, init)),

	tools: {
		list_accounts: tool({
			description: "Your Nova Bank accounts with their balances. Shows only the last four digits of each account number.",
			scope: "accounts:read",
			input: z.object({}),
			run: (_input, ctx) => ({
				accounts: accountsOf(ctx.account.id).map((a) => ({
					account_id: a.id,
					name: a.name,
					type: a.type,
					ending: a.endingDigits,
					balance: money(balanceCents(a)),
				})),
			}),
		}),
		list_transactions: tool({
			description: "Transactions on one of your accounts, newest first. It doesn't show balances; list_accounts does.",
			scope: "transactions:read",
			input: z.object({
				account_id: z.string().describe("An account_id from list_accounts"),
				from: z.iso.date().optional().describe("Earliest date, YYYY-MM-DD"),
				to: z.iso.date().optional().describe("Latest date, YYYY-MM-DD"),
				limit: z.number().int().min(1).max(100).optional().describe("How many to return. Default 20"),
			}),
			run: ({ account_id, from, to, limit }, ctx) => {
				const account = accountOf(ctx.account.id, account_id);
				if (!account) throw new ToolError(`No account ${account_id}. list_accounts lists yours.`);
				return {
					account_id,
					transactions: transactionsOf(account, { from, to, limit }).map((t) => ({
						transaction_id: t.id,
						date: t.date,
						description: t.description,
						category: t.category,
						amount: money(t.cents),
					})),
				};
			},
		}),
		get_rates: tool({
			description: "Nova Bank's published rates for savings, mortgages and personal loans. No sign-in needed.",
			scope: null,
			input: z.object({ product: z.enum(["savings", "mortgage", "personal_loan"]).optional().describe("Leave out to list every product") }),
			run: ({ product }) => ({ rates: RATES.filter((r) => !product || r.product === product), as_of: new Date().toISOString().slice(0, 10) }),
		}),
		find_branch: tool({
			description: `Nova Bank branches and whether they have an ATM. Cities served: ${CITIES.join(", ")}. No sign-in needed.`,
			scope: null,
			input: z.object({ city: z.string().optional().describe("City name; leave out to list every branch"), atm_only: z.boolean().optional() }),
			run: ({ city, atm_only }) => ({
				branches: BRANCHES.filter((b) => (!city || b.city.toLowerCase() === city.toLowerCase()) && (!atm_only || b.atm)),
			}),
		}),
	},
});

export { SITE_COOKIE };
