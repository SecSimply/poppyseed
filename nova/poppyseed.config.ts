import { definePoppyseed, memoryStore, OperationFailed, safeFetch, tool, ToolError } from "poppyseed";
import { after } from "next/server";
import { z } from "zod";
import { bank, money, needsOwnApproval, OWN_APPROVAL_OVER_CENTS, parseAmount, recordPerformed, zar } from "./lib/bank.ts";
import { siteCustomer } from "./lib/customers.ts";
import { approvalPolicy } from "./lib/approval-policy.ts";
import { devices } from "./lib/devices.ts";
import { baseUrl, isDev, secret } from "./lib/env.ts";
import { proteaAgent } from "./lib/support.ts";
import { BRANCHES, CITIES, RATES } from "./lib/products.ts";
import { blocked } from "./lib/blocklist.ts";
import { excludedTasks } from "./lib/excluded.ts";
import { adviceFor, remember } from "./lib/feedback.ts";

const allowLoopback = isDev || process.env.POPPYSEED_ALLOW_LOOPBACK_AGENTS === "1";

const amountField = z.string().describe('Amount in South African rand as a decimal string with a point, for example "1735.00"');
const referenceField = z.string().max(40).optional().describe("A short note that appears on the statement");

const create = () =>
	definePoppyseed({
		organization: { name: "Protea Bank", domain: new URL(baseUrl).hostname },
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
			"payments:write": `Propose payments to your saved payees and transfers between your own accounts. Payments over ${zar(OWN_APPROVAL_OVER_CENTS.payee)} and transfers over ${zar(OWN_APPROVAL_OVER_CENTS.transfer)} still need you to approve them yourself. It can't add a payee, and it is told if an account can't cover a payment.`,
		},
		// How consequential each scope is, so a personal agent can ask before requesting it.
		scopeHints: {
			"accounts:read": { changes: "none", personalData: true },
			"transactions:read": { changes: "none", personalData: true },
			"payments:write": { changes: "irreversible", personalData: true },
		},

		// Who is signed in to Protea Bank itself, so consent pages know whose accounts they connect.
		accounts: {
			current: async (request) => {
				const customer = await siteCustomer(request.headers.get("cookie"));
				return customer ? { id: customer.id, label: customer.email } : null;
			},
			signInUrl: (returnTo) => `/login?return_to=${encodeURIComponent(returnTo)}`,
		},
		// The bank's assistant, and a person behind it. Staff take handoffs at /staff.
		conversations: { agent: proteaAgent, handoff: { available: () => true } },
		// Direct and Device Sign-In only. Mediated Sign-In has an agent type the customer's password, which a bank should not teach.
		// With the conformance hooks on, codes poll every second and last ten, so the suite does not wait on real timings.
		signIn: { direct: true, device: process.env.POPPYSEED_TEST_HOOKS === "1" ? { interval: 1, expiresIn: 10 } : true },
		// An agent's browser can join its Session, so the pages show what that Session may see.
		web: {},

		// What Protea Bank does not offer an agent, on any interface. The chat, the tools and the website all keep to it.
		excludedTasks: excludedTasks(baseUrl),
		// An agent reports a task it could not do. It is kept for staff to read, as text, and answered with how to do it if we already can.
		feedback: (report, ctx) => {
			remember(report, ctx.clientId);
			return adviceFor(report);
		},
		// Agents refused by name. The list lives in lib/blocklist.ts, seeded from BLOCKED_CLIENTS and changed by staff.
		clients: { block: blocked },

		// Local agents (npx poppyseed agent) serve their metadata over http://127.0.0.1.
		dev: { allowInsecureClients: allowLoopback },
		fetch: (input, init) => (allowLoopback ? fetch(input, init) : safeFetch(input, init)),

		tools: {
			who_am_i: tool({
				readOnly: true,
				description: "The Protea Bank customer this connection is signed in as: their name and email address. Use it to tell the person who is signed in.",
				scope: "accounts:read",
				input: z.object({}),
				run: async (_input, ctx) => {
					const customer = await (await bank()).customer(ctx.account.id);
					if (!customer) throw new ToolError("This connection is not signed in as a Protea Bank customer.");
					return { name: customer.name, email: customer.email };
				},
			}),
			end_all_sign_ins: tool({
				description: "Ends every sign-in this agent has at Protea Bank for this customer, on every device, so the bank's connected-apps list no longer shows it. Only this agent's own sign-ins are ended; the customer can sign in again at any time.",
				scope: "accounts:read",
				input: z.object({}),
				run: async (_input, ctx) => {
					await poppyseed.connections.disconnect(ctx.account.id, ctx.clientId);
					return { ended: true };
				},
			}),
			list_accounts: tool({
				readOnly: true,
				description: "Your Protea Bank accounts with their balances. Shows only the last four digits of each account number.",
				scope: "accounts:read",
				input: z.object({}),
				run: async (_input, ctx) => ({
					accounts: (await (await bank()).balancesOf(ctx.account.id)).map((a) => ({
						account_id: a.id,
						name: a.name,
						type: a.type,
						ending: a.endingDigits,
						balance: money(a.balanceCents),
					})),
				}),
			}),
			list_transactions: tool({
				readOnly: true,
				description: "Transactions on one of your accounts, newest first. It doesn't show balances; list_accounts does.",
				scope: "transactions:read",
				input: z.object({
					account_id: z.string().describe("An account_id from list_accounts"),
					from: z.iso.date().optional().describe("Earliest date, YYYY-MM-DD"),
					to: z.iso.date().optional().describe("Latest date, YYYY-MM-DD"),
					limit: z.number().int().min(1).max(100).optional().describe("How many to return. Default 20"),
				}),
				run: async ({ account_id, from, to, limit }, ctx) => {
					const b = await bank();
					const account = await b.accountOf(ctx.account.id, account_id);
					if (!account) throw new ToolError(`No account ${account_id}. list_accounts lists yours.`);
					return {
						account_id,
						transactions: (await b.transactionsOf(account, { from, to, limit })).map((t) => ({
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
				readOnly: true,
				description: "Your saved payees, the only people and companies a payment can go to. It can't add a payee.",
				scope: "payments:write",
				input: z.object({}),
				run: async (_input, ctx) => ({ payees: (await (await bank()).payeesOf(ctx.account.id)).map((p) => ({ payee_id: p.id, name: p.name, ending: p.endingDigits })) }),
			}),
			pay_payee: tool({
				description: `Pay a saved payee from one of your accounts. Payments over ${zar(OWN_APPROVAL_OVER_CENTS.payee)} need the customer's own approval. Nothing is paid until it is confirmed: the customer can approve it on the page in its url, or their personal agent confirms it with their approval.`,
				scope: "payments:write",
				input: z.object({ payee_id: z.string().describe("A payee_id from list_payees"), from_account_id: z.string().describe("An account_id from list_accounts"), amount: amountField, reference: referenceField }),
				operation: {
					propose: async ({ payee_id, from_account_id, amount, reference }, ctx) => {
						const b = await bank();
						const cents = parseAmount(amount);
						if (!cents) throw new ToolError(`"${amount}" is not an amount. Use rand and cents such as "1735.00".`);
						const payee = await b.payeeOf(ctx.account.id, payee_id);
						if (!payee) throw new ToolError(`No saved payee ${payee_id}. list_payees lists yours. A payee can only be added by the customer, not by an agent.`);
						const from = await b.accountOf(ctx.account.id, from_account_id);
						if (!from) throw new ToolError(`No account ${from_account_id}. list_accounts lists yours.`);
						if ((await b.balanceCents(from)) < cents) throw new ToolError(`There is not enough money in ${from.name} ••${from.endingDigits} for ${zar(cents)}.`);
						const own = needsOwnApproval("payee", cents);
						const approval = approvalPolicy(own, await (await devices()).hasActive(ctx.account.id), "payment");
						return {
							key: `pay:${from.id}:${payee.id}`,
							summary: `Pay ${zar(cents)} to ${payee.name} (account ending ${payee.endingDigits}) from ${from.name} ••${from.endingDigits}${reference ? `, reference "${reference}"` : ""}. The money leaves today and can't be recalled.${approval.note}`,
							terms: { payee_id: payee.id, from_account_id: from.id, amount: money(cents), ...(reference ? { reference } : {}) },
							userApprovalRequired: approval.userApprovalRequired,
							approvalOnSite: approval.approvalOnSite,
							url: `${baseUrl}/payments/approve/{id}`,
							expiresIn: 15 * 60,
						};
					},
					perform: async ({ id, terms }, ctx) => {
						recordPerformed(id, terms);
						const b = await bank();
						const payee = await b.payeeOf(ctx.account.id, terms.payee_id);
						const cents = parseAmount(terms.amount.amount);
						if (!payee || !cents) throw new OperationFailed("The payee is no longer available. Nothing was paid.");
						const moved = await b.movePayment(id, ctx.account.id, { from: terms.from_account_id, description: `${payee.name}${terms.reference ? ` · ${terms.reference}` : ""}`, category: "payment", cents });
						if (!moved.ok) throw new OperationFailed(moved.reason);
						return { summary: `Paid ${zar(cents)} to ${payee.name}. Reference ${moved.reference}.`, data: { reference: moved.reference } };
					},
				},
			}),
			transfer_between_accounts: tool({
				description: `Move money between two of your own accounts. Transfers over ${zar(OWN_APPROVAL_OVER_CENTS.transfer)} need the customer's own approval. Nothing moves until it is confirmed: the customer can approve it on the page in its url, or their personal agent confirms it with their approval.`,
				scope: "payments:write",
				input: z.object({ from_account_id: z.string(), to_account_id: z.string(), amount: amountField, reference: referenceField }),
				operation: {
					propose: async ({ from_account_id, to_account_id, amount, reference }, ctx) => {
						const b = await bank();
						const cents = parseAmount(amount);
						if (!cents) throw new ToolError(`"${amount}" is not an amount. Use rand and cents such as "5000.00".`);
						const from = await b.accountOf(ctx.account.id, from_account_id);
						const to = await b.accountOf(ctx.account.id, to_account_id);
						if (!from || !to) throw new ToolError("Both accounts must be yours. list_accounts lists them.");
						if (from.id === to.id) throw new ToolError("Choose two different accounts.");
						if ((await b.balanceCents(from)) < cents) throw new ToolError(`There is not enough money in ${from.name} ••${from.endingDigits} for ${zar(cents)}.`);
						const own = needsOwnApproval("transfer", cents);
						const approval = approvalPolicy(own, await (await devices()).hasActive(ctx.account.id), "transfer");
						return {
							key: `xfer:${from.id}:${to.id}`,
							summary: `Move ${zar(cents)} from ${from.name} ••${from.endingDigits} to ${to.name} ••${to.endingDigits}${reference ? `, reference "${reference}"` : ""}.${approval.note}`,
							terms: { from_account_id: from.id, to_account_id: to.id, amount: money(cents), ...(reference ? { reference } : {}) },
							userApprovalRequired: approval.userApprovalRequired,
							approvalOnSite: approval.approvalOnSite,
							url: `${baseUrl}/payments/approve/{id}`,
							expiresIn: 15 * 60,
						};
					},
					perform: async ({ id, terms }, ctx) => {
						recordPerformed(id, terms);
						const b = await bank();
						const cents = parseAmount(terms.amount.amount);
						const to = await b.accountOf(ctx.account.id, terms.to_account_id);
						if (!cents || !to) throw new OperationFailed("An account is no longer available. Nothing was moved.");
						const moved = await b.movePayment(id, ctx.account.id, { from: terms.from_account_id, to: to.id, description: `Transfer to ${to.name} ••${to.endingDigits}${terms.reference ? ` · ${terms.reference}` : ""}`, category: "transfer", cents });
						if (!moved.ok) throw new OperationFailed(moved.reason);
						return { summary: `Moved ${zar(cents)}. Reference ${moved.reference}.`, data: { reference: moved.reference } };
					},
				},
			}),
			get_rates: tool({
				readOnly: true,
				description: "Protea Bank's published rates for savings, mortgages and personal loans. No sign-in needed.",
				scope: null,
				input: z.object({ product: z.enum(["savings", "mortgage", "personal_loan"]).optional().describe("Leave out to list every product") }),
				run: ({ product }) => ({ rates: RATES.filter((r) => !product || r.product === product), as_of: new Date().toISOString().slice(0, 10) }),
			}),
			find_branch: tool({
				readOnly: true,
				description: `Protea Bank branches and whether they have an ATM. Cities served: ${CITIES.join(", ")}. No sign-in needed.`,
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
	var __proteaPoppyseed: ReturnType<typeof create> | undefined;
}
export const poppyseed = (globalThis.__proteaPoppyseed ??= create());

