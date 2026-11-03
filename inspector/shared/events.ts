/** What the backend streams and the UI renders: one run is a list of these. */
export interface HttpMessage {
	headers: Record<string, string>;
	body?: string;
	/** True when `body` was cut at the size limit. */
	truncated?: boolean;
}

export type ProtocolEvent =
	| { type: "run.start"; runId: string; target: string; clientId: string; redacted: boolean; at: number }
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
	| { type: "run.end"; ok: boolean; at: number };

export interface InspectorConfig {
	target: string;
	clientId: string;
	redacted: boolean;
}
