import { randomUUID } from "node:crypto";
import { PapError, readBody, type Discovery, type TestAgent } from "poppyseed/agent";
import type { FaultInfo, ProtocolEvent } from "../shared/events.ts";
import { makeStep } from "./journey.ts";

/** One request in a fault test. `send` resolves when the company accepted it and throws a PapError when it refused. */
interface Attempt {
	title: string;
	expect: "accept" | "refuse";
	send: () => Promise<unknown>;
}

interface Fault extends FaultInfo {
	/** Builds the attempts; they may share state, such as one Session Key used twice. */
	attempts: (agent: TestAgent, company: Discovery) => Promise<Attempt[]>;
}

const BAD_AUDIENCE = "https://not-the-company.example";
const HOUR = 3600;

const refuse = (title: string, send: () => Promise<unknown>): Attempt => ({ title, expect: "refuse", send });
const accept = (title: string, send: () => Promise<unknown>): Attempt => ({ title, expect: "accept", send });
const one = (rule: string, id: string, title: string, send: (agent: TestAgent) => Promise<unknown>): Fault => ({ id, title, rule, attempts: async (agent) => [refuse(title, () => send(agent))] });

/** A response that is not a success, as the PapError the agent's own calls throw. */
const ok = async (response: Response) => {
	if (!response.ok) throw new PapError(response.status, await readBody(response), response.headers.get("www-authenticate"));
	return response;
};

/**
 * Requests the company must refuse, each bending one thing about a valid Session request. They follow the rules the
 * conformance suite holds sites to (spec 4.1 to 4.3, 9.4; RFC 9449). Every fault runs after a valid control request, so a
 * refusal can be put down to the fault and not to a broken setup.
 */
export const FAULTS: Fault[] = [
	one("A session assertion must be addressed to the company's issuer.", "assertion-wrong-audience", "Session assertion for another audience", (a) => a.startSession({ assertion: { audience: BAD_AUDIENCE } })),
	one("A session assertion must not be expired.", "assertion-expired", "Expired session assertion", (a) => a.startSession({ assertion: { iatOffset: -HOUR } })),
	one("A session assertion must not be dated in the future.", "assertion-future", "Session assertion from the future", (a) => a.startSession({ assertion: { iatOffset: HOUR } })),
	one("An assertion must be signed.", "assertion-unsigned", "Unsigned session assertion", (a) => a.startSession({ assertion: { alg: "none" } })),
	{
		id: "assertion-replay",
		title: "Session assertion used twice",
		rule: "Each assertion jti is accepted once.",
		attempts: async (agent) => {
			const jti = randomUUID();
			return [accept("First use of the assertion", () => agent.startSession({ assertion: { jti } })), refuse("Second use of the same assertion", () => agent.startSession({ assertion: { jti } }))];
		},
	},
	one("A client assertion must be addressed to the company's issuer.", "client-wrong-audience", "Client assertion for another audience", (a) => a.startSession({ clientAssertion: { audience: BAD_AUDIENCE } })),
	one("A client assertion may live at most 5 minutes.", "client-long-lived", "Client assertion valid for an hour", (a) => a.startSession({ clientAssertion: { lifetime: HOUR } })),
	one("A client assertion must be signed with a key published at the client's jwks_uri.", "client-embedded-key", "Client assertion carrying its own key", async (a) => {
		const session = await a.newSessionKey();
		return a.startSession({ clientAssertion: { header: { jwk: session.keys.publicJwk } } });
	}),
	one("The token request must authenticate the client.", "client-assertion-missing", "Token request without a client assertion", (a) => a.startSession({ omit: ["client_assertion"] })),
	{
		id: "client-assertion-replay",
		title: "Client assertion used twice",
		rule: "Each client assertion jti is accepted once.",
		attempts: async (agent) => {
			const jti = randomUUID();
			return [accept("First use of the client assertion", () => agent.startSession({ clientAssertion: { jti } })), refuse("Second use of the same client assertion", () => agent.startSession({ clientAssertion: { jti } }))];
		},
	},
	one("A token request must carry a DPoP proof (RFC 9449).", "dpop-missing", "Token request without a DPoP proof", (a) => a.startSession({ dpop: null })),
	one("A proof's htu must be the URL it is sent to.", "dpop-wrong-htu", "DPoP proof for another URL", (a) => a.startSession({ dpop: { htu: `${BAD_AUDIENCE}/token` } })),
	one("A proof's htm must be the request's method.", "dpop-wrong-htm", "DPoP proof for another method", (a) => a.startSession({ dpop: { htm: "GET" } })),
	one("A proof's iat must be recent.", "dpop-stale", "Stale DPoP proof", (a) => a.startSession({ dpop: { iatOffset: -HOUR } })),
	one("A proof must be signed by the key in its own header.", "dpop-wrong-signature", "DPoP proof signed with another key", (a) => a.startSession({ dpop: { wrongSigningKey: true } })),
	one("A proof's header must hold a public key only.", "dpop-private-key", "DPoP proof carrying the private key", (a) => a.startSession({ dpop: { leakPrivateKey: true } })),
	{
		id: "dpop-replay",
		title: "DPoP proof used twice",
		rule: "A proof jti is accepted once per key.",
		attempts: async (agent) => {
			const session = await agent.newSessionKey();
			const jti = randomUUID();
			const send = () => agent.startSession({ session, dpop: { session, jti } });
			return [accept("First use of the proof", send), refuse("Second use of the same proof", send)];
		},
	},
	{
		id: "token-other-key",
		title: "Access token used with another key",
		rule: "An access token works only with proofs from the key it is bound to.",
		attempts: async (agent) => {
			const mcp = agent.endpoint("mcp");
			const bound = await agent.startSession({ resource: mcp });
			const call = (proof?: { otherKey: true }) => agent.dpopFetch(mcp, bound.access_token, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }, proof).then(ok);
			return [accept("The token with its own key", () => call()), refuse("The same token with another key", () => call({ otherKey: true }))];
		},
	},
];

export const faultInfo: FaultInfo[] = FAULTS.map(({ id, title, rule }) => ({ id, title, rule }));

export interface FaultRunOptions {
	target: string;
	emit: (event: ProtocolEvent) => void;
	setStep: (id: string) => void;
	onDiscovered: (company: Discovery) => void;
}

/** Statuses that count as a refusal: the request was understood and denied. A 5xx is the company failing, not refusing. */
const REFUSED = new Set([400, 401, 403]);

/**
 * Discovers the company, sends a valid request as a control, then sends the fault. The run passes when the company
 * refused every request that should be refused and accepted every one that should not.
 */
export async function runFault(agent: TestAgent, fault: Fault, options: FaultRunOptions): Promise<boolean> {
	const { target, emit, setStep, onDiscovered } = options;
	const step = makeStep(emit, setStep);
	let company: Discovery | undefined;
	let attempts: Attempt[] = [];

	if (!(await step("discover", "Discover the company", async () => {
		company = await agent.discover(target);
		onDiscovered(company);
		return [`issuer: ${company.metadata.issuer}`, `token endpoint: ${company.metadata.token_endpoint}`];
	}))) return false;

	if (!(await step("control", "Control: a valid request", async () => {
		const session = await agent.startSession();
		return [`accepted: a valid Session request works (${session.token_type}, ${session.expires_in}s)`, "so a refusal below comes from the fault, not from a broken setup"];
	}))) return false;

	if (!(await step("build", `Prepare: ${fault.title}`, async () => {
		attempts = await fault.attempts(agent, company!);
		return [`rule: ${fault.rule}`];
	}))) return false;

	for (const [i, attempt] of attempts.entries()) {
		const passed = await step(`attempt-${i + 1}`, attempt.title, async () => {
			try {
				await attempt.send();
			} catch (error) {
				if (!(error instanceof PapError)) throw error;
				if (attempt.expect === "accept") throw new Error(`the company refused a request it should accept: HTTP ${error.status} ${JSON.stringify(error.body)}`);
				if (!REFUSED.has(error.status)) throw new Error(`HTTP ${error.status} is not a refusal${error.status >= 500 ? ": the company failed instead of refusing" : ""}. Rule: ${fault.rule}\n${JSON.stringify(error.body)}`);
				const body = error.body as { error?: string; error_description?: string } | null;
				return [`refused as required: HTTP ${error.status} ${body?.error ?? ""}`.trim(), ...(body?.error_description ? [`reason given: ${body.error_description}`] : []), `rule: ${fault.rule}`];
			}
			if (attempt.expect === "refuse") throw new Error(`the company ACCEPTED this request, and it must refuse it.\nRule: ${fault.rule}`);
			return ["accepted, as expected"];
		});
		if (!passed) return false;
	}
	return true;
}
