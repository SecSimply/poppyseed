/** What the backend streams and the UI renders: one run is a list of these. */
export interface HttpMessage {
	headers: Record<string, string>;
	body?: string;
	/** True when `body` was cut at the size limit. */
	truncated?: boolean;
}

export type ProtocolEvent =
	| { type: "run.start"; runId: string; target: string; clientId: string; redacted: boolean; signIn: boolean; at: number }
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

export interface InspectorConfig {
	target: string;
	clientId: string;
	redacted: boolean;
}
