import type { PoppyseedConfig } from "poppyseed";

export type ExcludedTask = NonNullable<PoppyseedConfig["excludedTasks"]>[number];

/**
 * Tasks Protea Bank does not offer a personal agent, on any interface (spec 8.1): not as a tool, not in the support
 * chat, and not on the website while an agent's browser is viewing it. Each says where the customer can do it instead.
 * `pattern` is how the chat recognises a request for it; `web` is a page on this site that does it for the customer.
 */
const TASKS: { task: string; pattern: RegExp; instructions: string; web?: string }[] = [
	{
		task: "Add a new payee",
		pattern: /\b(add|new|create|set up|save)\b.{0,30}\b(payee|beneficiary|recipient)\b|\b(payee|beneficiary)\b.{0,20}\b(add|new)\b/i,
		instructions: "Adding a payee is done by the customer, in their own browser at Protea Bank online banking, or at a branch in Paarl or Pretoria. An agent can pay a payee that is already saved.",
		web: "/payees",
	},
	{
		task: "Close an account",
		pattern: /\bclos(e|ing)\b.{0,30}\baccount\b|\baccount\b.{0,20}\bclos(e|ure)\b/i,
		instructions: "Accounts are closed in person at a branch in Paarl or Pretoria, with identification, or by the customer calling the head office in Paarl.",
	},
	{
		task: "Send an international payment",
		pattern: /\b(international|overseas|foreign|swift|abroad|cross[- ]border)\b.{0,30}\b(payment|transfer|wire|send)\b|\b(send|wire)\b.{0,30}\b(overseas|abroad|swift)\b/i,
		instructions: "International payments are made at the Pretoria branch or by the customer in online banking, where the bank can check the purpose of the payment as South African exchange control requires.",
	},
];

/** The list the site serves at `/poppy/excluded-tasks.json`, the same for everyone. A page is linked only over https, as the protocol requires; a local http site gets the words alone. */
export const excludedTasks = (baseUrl: string): ExcludedTask[] =>
	TASKS.map(({ task, instructions, web }) => ({ task, alternative: { instructions, ...(web && baseUrl.startsWith("https://") ? { references: [{ web: `${baseUrl}${web}` }] } : {}) } }));

/** The excluded task a message asks for, if any. */
export function excludedTaskOf(text: string): { task: string; instructions: string } | undefined {
	const found = TASKS.find((t) => t.pattern.test(text));
	return found && { task: found.task, instructions: found.instructions };
}

/** The task phrases, for tests and for the staff page. */
export const EXCLUDED_PHRASES = TASKS.map((t) => t.task);
