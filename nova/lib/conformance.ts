import type { Hooks, TargetProfile } from "poppyseed/agent";
import { poppyseed } from "../poppyseed.config";
import { performedTerms } from "./bank";
import { customerById } from "./customers";
import { SESSION_COOKIE, sealSession } from "./session";

/**
 * What `poppyseed check` needs to prove the rules it cannot see from outside: which tools to call, and a few company
 * powers (sign a test person in, act as staff, end a Session). Served at /test-hooks only when POPPYSEED_TEST_HOOKS=1,
 * which is never set on the production service. The two test people are Protea Bank's two demo customers.
 */
const PEOPLE = { alice: "cus_thandi", bob: "cus_pieter" } as const;

/** A Cookie header that signs a test person in to the site, as the sign-in at Curity would. */
const cookieFor = async (id: (typeof PEOPLE)[keyof typeof PEOPLE]): Promise<string> => {
	const customer = (await customerById(id))!;
	return `${SESSION_COOKIE}=${sealSession({ sub: `test:${id}`, email: customer.email, name: customer.name, customerId: id, staff: false })}`;
};

const staff = { id: "aut_support", name: "Protea Bank support" };

export const hooks = {
	endSession: (sessionId) => poppyseed.endSession(sessionId),
	siteSignIn: (person) => cookieFor(PEOPLE[person]),
	connections: (person) => poppyseed.connections.list(PEOPLE[person]),
	disconnect: (person, clientId) => poppyseed.connections.disconnect(PEOPLE[person], clientId),
	staffJoin: (id) => poppyseed.conversations.join(id),
	staffReply: (id, text) => poppyseed.conversations.reply(id, text, { author: staff }),
	staffCallTool: async (id, name, input) => ({ kind: (await poppyseed.conversations.callTool(id, name, input)).kind }),
	performed: async (operationId) => performedTerms(operationId),
} satisfies Hooks;

const everyday = "acc_thandi_everyday";
const pay = (amount: string) => ({ payee_id: "pye_thandi_energy", from_account_id: everyday, amount, reference: "check" });

export const profile = {
	publicTool: { name: "get_rates", arguments: { product: "savings" } },
	scopedTool: { name: "list_accounts", arguments: {}, scope: "accounts:read" },
	// Another scope than scopedTool's, so a check can grant one and not the other.
	writeTool: { name: "list_payees", arguments: {}, scope: "payments:write" },
	operations: {
		// Small enough for an agent to confirm under a standing permission; the revision differs in the amount.
		action: { name: "pay_payee", arguments: pay("10.00"), revisedArguments: pay("11.00"), scope: "payments:write" },
		// Over R500: the bank requires the person's own approval.
		approvalAction: { name: "pay_payee", arguments: pay("6000.00"), scope: "payments:write" },
	},
	conversations: { hello: "What are your savings rates?", accountRequest: "What are my balances?" },
	web: { accountPage: "/account/summary" },
} satisfies TargetProfile;
