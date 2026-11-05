import type { ConversationEvent, ConversationReply, TestAgent } from "poppyseed/agent";

/** The parts of the agent this needs, so it can be tested with a stand-in. */
export type ChatAgent = Pick<TestAgent, "startConversation" | "handoff" | "events" | "message">;

export interface Chat {
	conversationId: string;
	/** What was said and what the company did, in order, for the step's summary. */
	lines: string[];
	status: string;
	responder: string;
}

const WAIT_SECONDS = 15;
const ROUNDS = 4;
const clip = (text: string, to = 400) => (text.length > to ? `${text.slice(0, to)}…` : text);

/** One event as a line a person can read. Events of a kind this does not know are skipped, as the protocol says to. */
export function describe(event: ConversationEvent): string | undefined {
	if (event.type === "message" && event.message) {
		const m = event.message;
		const text = m.text ?? (m.data ? "(structured data)" : "(no text)");
		if (m.role === "user") return `you: ${clip(text)}`;
		return `${m.author.name ?? (m.author.type === "human" ? "a person" : "the company's agent")}: ${clip(text)}`;
	}
	if (event.type === "authorization") return `the company asks for the scope ${event.scope ?? "?"}: ${event.error ?? "authorization needed"}`;
	if (event.type === "state") return `state: ${event.status}, handled by ${event.responder}`;
	return undefined;
}

const answered = (events: ConversationEvent[]) => events.some((e) => e.type === "message" && e.message?.role === "company") || events.some((e) => e.type === "authorization");

/**
 * Says something to the company's agent and waits for it to answer. The answer is read from the events, as the
 * protocol has it: the company may reply a moment after accepting the message, so this reads again, a few times.
 */
export async function askSupport(agent: ChatAgent, token: string, text: string): Promise<Chat> {
	const reply: ConversationReply = await agent.startConversation(token, agent.message(text), { wait: WAIT_SECONDS });
	const events: ConversationEvent[] = [...(reply.events ?? [])];
	let cursor = reply.cursor ?? undefined;
	let page = reply;
	for (let round = 0; round < ROUNDS && !answered(events); round++) {
		const more = await agent.events(token, reply.conversation_id, { cursor, wait: WAIT_SECONDS });
		events.push(...more.events);
		cursor = more.cursor ?? cursor;
		page = { ...page, status: more.status, responder: more.responder };
	}
	const lines = events.map(describe).filter((l): l is string => l !== undefined);
	if (!answered(events)) lines.push("no answer from the company's agent yet");
	return { conversationId: reply.conversation_id, lines, status: page.status, responder: page.responder };
}

/**
 * Asks for a person and reports what the company says. The conversation is left open: it is now in the company's
 * queue, where staff can take it, and closing it here would take it away before anyone could.
 */
export async function askForPerson(agent: ChatAgent, token: string, conversationId: string): Promise<string[]> {
	const reply = await agent.handoff(token, conversationId);
	const lines = [`asked for a person: ${reply.status}, handled by ${reply.responder}`];
	for (const event of reply.events ?? []) {
		const line = describe(event);
		if (line && !line.startsWith("state:")) lines.push(line);
	}
	return lines;
}
