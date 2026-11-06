import type { AgentTurn, CompanyAgent } from "poppyseed";
import { zar } from "./bank.ts";
import { excludedTaskOf } from "./excluded.ts";
import { CITIES } from "./products.ts";

/** What a customer's message is asking for. Plain keyword matching: this is a scripted agent, and says what it can do. */
export type Intent = "person" | "excluded" | "pay" | "transactions" | "balances" | "branch" | "rates" | "help";

export function intentOf(text: string): Intent {
	const t = text.toLowerCase();
	if (/\b(person|human|someone|somebody|operator|staff|colleague|real agent)\b/.test(t)) return "person";
	if (excludedTaskOf(text)) return "excluded";
	if (/\b(pay|paying|transfer|send money|wire|move money|payment)\b/.test(t)) return "pay";
	if (/\b(transactions?|statement|spent|spending|recent activity|purchases)\b/.test(t)) return "transactions";
	if (/\b(balances?|how much|my accounts?)\b/.test(t)) return "balances";
	if (/\b(branch|branches|atm|cash machine|opening hours|open on)\b/.test(t)) return "branch";
	if (/\b(rates?|interest|savings?|mortgage|loan|apr)\b/.test(t)) return "rates";
	return "help";
}

/** "-1735.00" as "-R1 735,00". */
const rand = (amount: string) => zar(Math.round(Number(amount) * 100));

type Rates = { rates: { name: string; rate_percent: number; kind: "earned" | "charged"; term?: string }[] };
type Branches = { branches: { name: string; city: string; address: string; hours: string; atm: boolean }[] };
type Accounts = { accounts: { account_id: string; name: string; type: string; ending: string; balance: { amount: string } }[] };
type Transactions = { transactions: { date: string; description: string; amount: { amount: string } }[] };

const HELP = "I'm Protea Bank's assistant. I can tell you our rates, find a branch or ATM, and, once you have signed in, show your balances and recent transactions. For anything else I can pass you to a person.";

/**
 * Protea Bank's support agent. It reads and explains. It never moves money: a payment is proposed by a tool as an
 * operation the customer approves, and a chat message is never an approval. It uses the caller's own scopes, so a
 * session that has not signed in is asked to, and sees nothing of anyone's accounts.
 */
export const proteaAgent: CompanyAgent = {
	async reply(turn: AgentTurn) {
		const text = turn.latest.map((m) => m.text ?? "").join(" ");
		switch (intentOf(text)) {
			case "person":
				return turn.handoff();
			case "excluded": {
				// A task the bank does not offer an agent, and where to do it. The same list the site serves.
				const task = excludedTaskOf(text)!;
				return turn.say(`I can't do that for you here (${task.task.toLowerCase()}). ${task.instructions} I can pass you to a person if you would like.`);
			}
			case "pay":
				return turn.say("I can't make payments in a chat. A payment is proposed as an operation that you approve yourself, and larger ones need your own approval each time. Ask your personal agent to use the payment tools, or I can pass you to a person.");
			case "rates": {
				const result = await turn.callTool("get_rates", {});
				if (result.kind !== "output") return turn.say(HELP);
				const { rates } = result.output as Rates;
				return turn.say(`Our current rates: ${rates.map((r) => `${r.name} ${r.rate_percent.toFixed(2)}% ${r.kind}${r.term ? ` over ${r.term}` : ""}`).join("; ")}.`);
			}
			case "branch": {
				const city = CITIES.find((c) => text.toLowerCase().includes(c.toLowerCase()));
				const result = await turn.callTool("find_branch", { ...(city ? { city } : {}), ...(/\batm|cash machine/i.test(text) ? { atm_only: true } : {}) });
				if (result.kind !== "output") return turn.say(HELP);
				const { branches } = result.output as Branches;
				if (!branches.length) return turn.say("I couldn't find a branch matching that. We have branches in " + CITIES.join(", ") + ".");
				return turn.say(branches.map((b) => `${b.name}, ${b.address}. ${b.hours}. ${b.atm ? "ATM on site" : "No ATM"}.`).join(" "));
			}
			case "balances": {
				// A caller without accounts:read is asked for the scope by the platform; there is nothing more to say.
				const result = await turn.callTool("list_accounts", {});
				if (result.kind !== "output") return;
				const { accounts } = result.output as Accounts;
				return turn.say(accounts.length ? `Your balances: ${accounts.map((a) => `${a.name} ending ${a.ending}, ${rand(a.balance.amount)}`).join("; ")}.` : "You have no accounts with us yet.");
			}
			case "transactions": {
				const accounts = await turn.callTool("list_accounts", {});
				if (accounts.kind !== "output") return;
				const everyday = (accounts.output as Accounts).accounts.find((a) => a.type === "cheque");
				if (!everyday) return turn.say("I couldn't find a cheque account to read transactions from.");
				const result = await turn.callTool("list_transactions", { account_id: everyday.account_id, limit: 5 });
				if (result.kind !== "output") return;
				const { transactions } = result.output as Transactions;
				return turn.say(`Your latest transactions on ${everyday.name} ending ${everyday.ending}: ${transactions.map((t) => `${t.date} ${t.description} ${rand(t.amount.amount)}`).join("; ")}.`);
			}
			default:
				return turn.say(HELP);
		}
	},
};
