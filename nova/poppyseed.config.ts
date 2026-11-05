import { definePoppyseed, memoryStore, OperationFailed, safeFetch, tool, ToolError } from "poppyseed";
import { after } from "next/server";
import { z } from "zod";
import { accountOf, accountsOf, balanceCents, money, movePayment, needsOwnApproval, OWN_APPROVAL_OVER_CENTS, parseAmount, payeeOf, payeesOf, transactionsOf, usd } from "./lib/bank.ts";
import { SITE_COOKIE, siteCustomer } from "./lib/customers.ts";
import { novaAgent } from "./lib/support.ts";
import { BRANCHES, CITIES, RATES } from "./lib/products.ts";

const isDev = process.env.NODE_ENV !== "production";
const allowLoopback = isDev || process.env.POPPYSEED_ALLOW_LOOPBACK_AGENTS === "1";
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const baseUrl = process.env.POPPYSEED_BASE_URL ?? (isDev || isBuild ? "http://localhost:3000" : undefined);
if (!baseUrl) throw new Error("Set POPPYSEED_BASE_URL to the public origin in production");
const secret = process.env.POPPYSEED_SECRET ?? (isDev || isBuild ? "dev-only-secret-change-me-in-production!!" : undefined);
if (!secret) throw new Error("Set POPPYSEED_SECRET (32+ characters) in production");

const amountField = z.string().describe('Amount in US dollars as a decimal string, for example "96.40"');
const referenceField = z.string().max(40).optional().describe("A short note that appears on the statement");

const create = () =>
	definePoppyseed({
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
			"payments:write": `Propose payments to your saved payees and transfers between your own accounts. Payments over ${usd(OWN_APPROVAL_OVER_CENTS.payee)} and transfers over ${usd(OWN_APPROVAL_OVER_CENTS.transfer)} still need you to approve them yourself. It can't add a payee, and it is told if an account can't cover a payment.`,
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
		// The bank's assistant, and a person behind it. Staff take handoffs at /staff.
		conversations: { agent: novaAgent, handoff: { available: () => true } },
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
			list_payees: tool({
				description: "Your saved payees, the only people and companies a payment can go to. It can't add a payee.",
				scope: "payments:write",
				input: z.object({}),
				run: (_input, ctx) => ({ payees: payeesOf(ctx.account.id).map((p) => ({ payee_id: p.id, name: p.name, ending: p.endingDigits })) }),
			}),
			pay_payee: tool({
				description: `Pay a saved payee from one of your accounts. Payments over ${usd(OWN_APPROVAL_OVER_CENTS.payee)} need the customer's own approval. Returns an operation to confirm.`,
				scope: "payments:write",
				input: z.object({ payee_id: z.string().describe("A payee_id from list_payees"), from_account_id: z.string().describe("An account_id from list_accounts"), amount: amountField, reference: referenceField }),
				operation: {
					propose: ({ payee_id, from_account_id, amount, reference }, ctx) => {
						const cents = parseAmount(amount);
						if (!cents) throw new ToolError(`"${amount}" is not an amount. Use dollars and cents such as "96.40".`);
						const payee = payeeOf(ctx.account.id, payee_id);
						if (!payee) throw new ToolError(`No saved payee ${payee_id}. list_payees lists yours. A payee can only be added by the customer, not by an agent.`);
						const from = accountOf(ctx.account.id, from_account_id);
						if (!from) throw new ToolError(`No account ${from_account_id}. list_accounts lists yours.`);
						if (balanceCents(from) < cents) throw new ToolError(`There is not enough money in ${from.name} ••${from.endingDigits} for ${usd(cents)}.`);
						const own = needsOwnApproval("payee", cents);
						return {
							key: `pay:${from.id}:${payee.id}`,
							summary: `Pay ${usd(cents)} to ${payee.name} (account ending ${payee.endingDigits}) from ${from.name} ••${from.endingDigits}${reference ? `, reference "${reference}"` : ""}. The money leaves today and can't be recalled.${own ? " This payment is over the limit for a standing permission, so you must approve it yourself." : ""}`,
							terms: { payee_id: payee.id, from_account_id: from.id, amount: money(cents), ...(reference ? { reference } : {}) },
							userApprovalRequired: own,
							url: `${baseUrl}/payments`,
							expiresIn: 15 * 60,
						};
					},
					perform: ({ id, terms }, ctx) => {
						const payee = payeeOf(ctx.account.id, terms.payee_id);
						const cents = parseAmount(terms.amount.amount);
						if (!payee || !cents) throw new OperationFailed("The payee is no longer available. Nothing was paid.");
						const moved = movePayment(id, ctx.account.id, { from: terms.from_account_id, description: `${payee.name}${terms.reference ? ` · ${terms.reference}` : ""}`, category: "payment", cents });
						if (!moved.ok) throw new OperationFailed(moved.reason);
						return { summary: `Paid ${usd(cents)} to ${payee.name}. Reference ${moved.reference}.`, data: { reference: moved.reference } };
					},
				},
			}),
			transfer_between_accounts: tool({
				description: `Move money between two of your own accounts. Transfers over ${usd(OWN_APPROVAL_OVER_CENTS.transfer)} need the customer's own approval. Returns an operation to confirm.`,
				scope: "payments:write",
				input: z.object({ from_account_id: z.string(), to_account_id: z.string(), amount: amountField, reference: referenceField }),
				operation: {
					propose: ({ from_account_id, to_account_id, amount, reference }, ctx) => {
						const cents = parseAmount(amount);
						if (!cents) throw new ToolError(`"${amount}" is not an amount. Use dollars and cents such as "250.00".`);
						const from = accountOf(ctx.account.id, from_account_id);
						const to = accountOf(ctx.account.id, to_account_id);
						if (!from || !to) throw new ToolError("Both accounts must be yours. list_accounts lists them.");
						if (from.id === to.id) throw new ToolError("Choose two different accounts.");
						if (balanceCents(from) < cents) throw new ToolError(`There is not enough money in ${from.name} ••${from.endingDigits} for ${usd(cents)}.`);
						const own = needsOwnApproval("transfer", cents);
						return {
							key: `xfer:${from.id}:${to.id}`,
							summary: `Move ${usd(cents)} from ${from.name} ••${from.endingDigits} to ${to.name} ••${to.endingDigits}${reference ? `, reference "${reference}"` : ""}.${own ? " This transfer is over the limit for a standing permission, so you must approve it yourself." : ""}`,
							terms: { from_account_id: from.id, to_account_id: to.id, amount: money(cents), ...(reference ? { reference } : {}) },
							userApprovalRequired: own,
							url: `${baseUrl}/payments`,
							expiresIn: 15 * 60,
						};
					},
					perform: ({ id, terms }, ctx) => {
						const cents = parseAmount(terms.amount.amount);
						const to = accountOf(ctx.account.id, terms.to_account_id);
						if (!cents || !to) throw new OperationFailed("An account is no longer available. Nothing was moved.");
						const moved = movePayment(id, ctx.account.id, { from: terms.from_account_id, to: to.id, description: `Transfer to ${to.name} ••${to.endingDigits}${terms.reference ? ` · ${terms.reference}` : ""}`, category: "transfer", cents });
						if (!moved.ok) throw new OperationFailed(moved.reason);
						return { summary: `Moved ${usd(cents)}. Reference ${moved.reference}.`, data: { reference: moved.reference } };
					},
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

// One instance per process. A page and an API route can be bundled separately and would otherwise each build their own,
// with their own store: a conversation started through the API would be missing from the staff page.
declare global {
	var __novaPoppyseed: ReturnType<typeof create> | undefined;
}
export const poppyseed = (globalThis.__novaPoppyseed ??= create());

export { SITE_COOKIE };
