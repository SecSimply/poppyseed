/** What the backend streams and the UI renders: one run is a list of these. */
export interface HttpMessage {
	headers: Record<string, string>;
	body?: string;
	/** True when `body` was cut at the size limit. */
	truncated?: boolean;
}

/** One thing checked about a token, with the value found and the rule it was held to. */
export interface Check {
	name: string;
	status: "pass" | "fail" | "info";
	detail: string;
}

/**
 * A JWT the agent sent, decoded for reading. Only the header and claims travel to the browser: the signature, which
 * is what makes the token usable, stays on the server, so no credential is exposed to read one.
 */
export interface DecodedJwt {
	/** Where it was found: "DPoP header", "client_assertion", "assertion". */
	where: string;
	kind: "DPoP proof" | "Client assertion" | "Session assertion";
	header: Record<string, unknown>;
	claims: Record<string, unknown>;
	checks: Check[];
}

export type ProtocolEvent =
	| { type: "run.start"; runId: string; target: string; clientId: string; redacted: boolean; signIn: boolean; fault?: string; at: number }
	| { type: "step.start"; step: string; title: string; at: number }
	| {
			type: "http";
			step: string;
			at: number;
			ms: number;
			request: HttpMessage & { method: string; url: string };
			/** Absent when the request failed before any response (DNS, TLS, timeout). */
			response?: HttpMessage & { status: number };
			error?: string;
			/** Likely causes, when the response was a refusal the inspector recognises. */
			hints?: string[];
			/** JWTs in the request, decoded and checked. */
			jwts?: DecodedJwt[];
	  }
	| { type: "step.end"; step: string; ok: boolean; summary: string[]; error?: string; at: number }
	/** The run is waiting for a person: to approve on the company's page, or to decide in the inspector. */
	| { type: "action.required"; step: string; kind: "device-signin" | "open-link" | "approve-operation"; title: string; lines: string[]; link?: string; code?: string; expiresAt?: number; at: number }
	| { type: "action.resolved"; step: string; outcome: string; at: number }
	| { type: "run.end"; ok: boolean; at: number };

/** Who may use the inspector, and how they sign in. Public: it is what the login screen reads. */
export interface AuthInfo {
	/** Sign in with Curity (OpenID Connect, authorization code with PKCE) is configured. */
	oidc: boolean;
	/** A shared access token is also accepted. */
	token: boolean;
	user?: { sub: string; email?: string };
}

/** A deliberately broken request the inspector can send, to see how the site refuses it. */
export interface FaultInfo {
	id: string;
	title: string;
	/** The rule the site must enforce, in a sentence. */
	rule: string;
}

export interface InspectorConfig {
	target: string;
	clientId: string;
	redacted: boolean;
	faults: FaultInfo[];
	/** Operations the longer run can propose, for the person to choose between. One when only one is configured. */
	operations: { label: string }[];
}
