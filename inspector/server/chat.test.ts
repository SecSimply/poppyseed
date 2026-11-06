import type { ConversationEvent, ConversationReply, EventPage } from "poppyseed/agent";
import { describe, expect, it } from "vitest";
import { askForPerson, askSupport, describe as say, type ChatAgent } from "./chat.ts";

const message = (role: "user" | "company", text: string, name?: string): ConversationEvent => ({ id: `evt_${text}`, type: "message", created_at: "now", message: { id: "m", role, author: { type: role === "company" && name ? "human" : "agent", ...(name ? { name } : {}) }, text } });
const reply = (events: ConversationEvent[], over: Partial<ConversationReply> = {}): ConversationReply => ({ httpStatus: 201, conversation_id: "cnv_1", status: "open", responder: "agent", events, cursor: "c1", ...over }) as ConversationReply;
const page = (events: ConversationEvent[], over: Partial<EventPage> = {}): EventPage => ({ conversation_id: "cnv_1", events, cursor: "c2", has_more: false, status: "open", responder: "agent", ...over });

function agentWith(start: ConversationReply, later: EventPage[] = []) {
	const reads: (string | undefined)[] = [];
	const agent: ChatAgent = {
		message: (text) => ({ id: "msg_1", author: { type: "agent" }, text }),
		startConversation: async () => start,
		events: async (_t, _id, options) => (reads.push(options?.cursor), later.shift() ?? page([])),
		handoff: async () => reply([{ id: "e", type: "state", created_at: "now", status: "waiting", responder: "human" } as ConversationEvent, message("company", "A person will be with you shortly.", "Protea Bank support")], { status: "waiting", responder: "human" }),
	};
	return { agent, reads };
}

describe("askSupport", () => {
	it("reads the company's answer when it arrives with the first reply", async () => {
		const { agent, reads } = agentWith(reply([message("user", "rates?"), message("company", "Protea Saver 3.90% earned.")]));
		const chat = await askSupport(agent, "t", "rates?");
		expect(chat.lines).toEqual(["you: rates?", "the company's agent: Protea Saver 3.90% earned."]);
		expect(reads).toEqual([]);
		expect(chat.conversationId).toBe("cnv_1");
	});

	it("reads again from the cursor when the company answers a moment later", async () => {
		const { agent, reads } = agentWith(reply([message("user", "balances?")]), [page([]), page([message("company", "Your balances: …")], { cursor: "c3" })]);
		const chat = await askSupport(agent, "t", "balances?");
		expect(chat.lines.at(-1)).toContain("Your balances");
		expect(reads).toEqual(["c1", "c2"]);
	});

	it("says so when no answer comes, instead of reporting a silence as success", async () => {
		const { agent } = agentWith(reply([message("user", "hello")]));
		const chat = await askSupport(agent, "t", "hello");
		expect(chat.lines.at(-1)).toBe("no answer from the company's agent yet");
	});

	it("treats a request for a scope as the company's answer, and shows which scope", async () => {
		const asked = { id: "e", type: "authorization", created_at: "now", scope: "accounts:read", error: "insufficient_scope" } as ConversationEvent;
		const { agent } = agentWith(reply([message("user", "balances"), asked]));
		const chat = await askSupport(agent, "t", "balances");
		expect(chat.lines).toContain("the company asks for the scope accounts:read: insufficient_scope");
		expect(chat.lines).not.toContain("no answer from the company's agent yet");
	});
});

describe("describe", () => {
	it("names a person when staff write, and skips event types it does not know", () => {
		expect(say(message("company", "Hello", "Protea Bank support"))).toBe("Protea Bank support: Hello");
		expect(say({ id: "e", type: "something_new", created_at: "now" })).toBeUndefined();
	});

	it("cuts a very long message", () => {
		expect(say(message("company", "x".repeat(900)))!.length).toBeLessThan(450);
	});
});

describe("askForPerson", () => {
	it("reports the handoff and what the company said, and leaves the conversation open for staff", async () => {
		const { agent } = agentWith(reply([]));
		const lines = await askForPerson(agent, "t", "cnv_1");
		expect(lines).toEqual(["asked for a person: waiting, handled by human", "Protea Bank support: A person will be with you shortly."]);
		expect("closeConversation" in agent).toBe(false);
	});
});
