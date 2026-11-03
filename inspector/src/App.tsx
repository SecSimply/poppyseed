import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthInfo, InspectorConfig, ProtocolEvent } from "../shared/events.ts";
import { cancelRun, decide, getAuthInfo, getConfig, logout, startRun, streamRun, Unauthorized } from "./api.ts";

type Http = Extract<ProtocolEvent, { type: "http" }>;
interface Step {
	id: string;
	title: string;
	status: "running" | "ok" | "failed";
	summary: string[];
	error?: string;
	http: Http[];
}

const TOKEN_KEY = "inspector-token";
const remember = (): string => {
	try {
		return sessionStorage.getItem(TOKEN_KEY) ?? "";
	} catch {
		return "";
	}
};

/** One run's events, folded into steps, each with the requests it made. */
function toSteps(events: ProtocolEvent[]): Step[] {
	const steps = new Map<string, Step>();
	for (const e of events) {
		if (e.type === "step.start") steps.set(e.step, { id: e.step, title: e.title, status: "running", summary: [], http: [] });
		else if (e.type === "http") steps.get(e.step)?.http.push(e);
		else if (e.type === "step.end") {
			const s = steps.get(e.step);
			if (s) Object.assign(s, { status: e.ok ? "ok" : "failed", summary: e.summary, error: e.error });
		}
	}
	return [...steps.values()];
}

const pretty = (body?: string) => {
	if (!body) return "";
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
};

type Action = Extract<ProtocolEvent, { type: "action.required" }>;

/** The run is waiting for a person: the latest action.required that nothing has resolved, while the run is live. */
function pendingAction(events: ProtocolEvent[]): Action | undefined {
	if (events.some((e) => e.type === "run.end")) return undefined;
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i]!;
		if (e.type === "action.required") return e;
		if (e.type === "action.resolved") return undefined;
	}
	return undefined;
}

function ActionPanel({ action, onDecide }: { action: Action; onDecide: (d: "approve" | "decline") => void }) {
	return (
		<section className="action" role="alert" aria-live="polite">
			<h2>{action.title}</h2>
			{action.lines.map((l, i) => (
				<p key={i}>{l}</p>
			))}
			{action.code && (
				<p>
					Code <code className="code">{action.code}</code>
				</p>
			)}
			{action.link && /^https?:\/\//.test(action.link) && (
				<p>
					<a href={action.link} target="_blank" rel="noopener noreferrer">
						{action.link}
					</a>
				</p>
			)}
			{action.kind === "approve-operation" && (
				<p className="buttons">
					<button className="run" onClick={() => onDecide("approve")}>Approve</button>
					<button onClick={() => onDecide("decline")}>Decline</button>
				</p>
			)}
			{action.kind !== "approve-operation" && <p className="note">Waiting for the person. The run continues when they have decided.</p>}
		</section>
	);
}

function Headers({ headers }: { headers: Record<string, string> }) {
	const entries = Object.entries(headers);
	return entries.length ? (
		<pre className="headers">{entries.map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
	) : null;
}

function Exchange({ http }: { http: Http }) {
	const status = http.response?.status;
	const bad = http.error !== undefined || (status !== undefined && status >= 400);
	const path = (() => {
		try {
			const u = new URL(http.request.url);
			return u.pathname + u.search;
		} catch {
			return http.request.url;
		}
	})();
	return (
		<details className="exchange" open={bad}>
			<summary>
				<span className="method">{http.request.method}</span> <code>{path}</code>{" "}
				<span className={bad ? "status bad" : "status"}>{http.error ? "failed" : status}</span> <span className="ms">{http.ms} ms</span>
			</summary>
			<div className="panes">
				<section>
					<h4>Request</h4>
					<code className="url">{http.request.url}</code>
					<Headers headers={http.request.headers} />
					{http.request.body && <pre>{pretty(http.request.body)}</pre>}
				</section>
				<section>
					<h4>Response</h4>
					{http.error && <pre className="error">{http.error}</pre>}
					{http.response && <Headers headers={http.response.headers} />}
					{http.response?.body && <pre>{pretty(http.response.body)}</pre>}
					{http.response?.truncated && <p className="note">Body truncated at 64 KB.</p>}
				</section>
			</div>
		</details>
	);
}

export function App() {
	const [auth, setAuth] = useState<AuthInfo>();
	const [token, setToken] = useState(remember);
	const [config, setConfig] = useState<InspectorConfig>();
	const [events, setEvents] = useState<ProtocolEvent[]>([]);
	const [runId, setRunId] = useState<string>();
	const [selected, setSelected] = useState<string>();
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string>();
	const abort = useRef<AbortController>(undefined);

	const connect = useCallback(async (t: string) => {
		try {
			setConfig(await getConfig(t));
			setError(undefined);
			if (t) {
				try {
					sessionStorage.setItem(TOKEN_KEY, t);
				} catch {
					/* private mode: the token just isn't remembered */
				}
			}
		} catch (e) {
			setConfig(undefined);
			if (!(e instanceof Unauthorized) || t) setError(e instanceof Unauthorized ? "That token was not accepted." : String(e));
		}
	}, []);

	useEffect(() => {
		void getAuthInfo()
			.then((info) => {
				setAuth(info);
				// Signed in with Curity, a remembered token, or a development server with no login at all.
				if (info.user || token || (!info.oidc && !info.token)) return connect(token);
			})
			.catch((e) => setError(String(e)));
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const run = useCallback(
		async (signIn: boolean) => {
			abort.current?.abort();
			const controller = (abort.current = new AbortController());
			setEvents([]);
			setSelected(undefined);
			setError(undefined);
			setRunning(true);
			try {
				const id = await startRun(token, signIn);
				setRunId(id);
				await streamRun(token, id, (e) => setEvents((prev) => [...prev, e]), controller.signal);
			} catch (e) {
				if (!controller.signal.aborted) setError(String(e instanceof Error ? e.message : e));
			} finally {
				setRunning(false);
			}
		},
		[token],
	);

	const answer = (d: "approve" | "decline") => runId && void decide(token, runId, d).catch((e) => setError(String(e.message ?? e)));
	const signOut = async () => {
		await logout();
		setConfig(undefined);
		setEvents([]);
		setAuth(await getAuthInfo());
	};

	const steps = useMemo(() => toSteps(events), [events]);
	const current = steps.find((s) => s.id === selected) ?? steps.at(-1);
	const end = events.find((e) => e.type === "run.end");
	const action = pendingAction(events);

	return (
		<main>
			<header>
				<h1>Poppy Inspector</h1>
				{config ? (
					<p className="meta">
						<span>Target <code>{config.target}</code></span>
						<span>Agent <code>{config.clientId}</code></span>
						{auth?.user && (
							<span>
								Signed in as <code>{auth.user.email ?? auth.user.sub}</code> <button className="link" onClick={() => void signOut()}>Sign out</button>
							</span>
						)}
						{!config.redacted && <strong className="warn">credentials are not redacted</strong>}
					</p>
				) : (
					auth && (
						<div className="login">
							{auth.oidc && (
								<p>
									<a className="button run" href="/auth/login">Sign in with Curity</a>
								</p>
							)}
							{auth.token && (
								<form
									onSubmit={(e) => {
										e.preventDefault();
										void connect(token);
									}}
								>
									<label>
										{auth.oidc ? "Or an access token " : "Access token "}
										<input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
									</label>
									<button>Connect</button>
								</form>
							)}
						</div>
					)
				)}
				{error && <p role="alert" className="error">{error}</p>}
			</header>

			{config && (
				<>
					<div className="controls">
						<button className="run" onClick={() => void run(false)} disabled={running}>
							{running ? "Running…" : "Run journey"}
						</button>
						<button onClick={() => void run(true)} disabled={running} title="Needs a person to approve in their own browser">
							Run with sign-in and operations
						</button>
						{running && runId && <button onClick={() => void cancelRun(token, runId)}>Cancel</button>}
						{end?.type === "run.end" && <span className={end.ok ? "pill ok" : "pill failed"}>{end.ok ? "all steps passed" : "stopped at a failing step"}</span>}
					</div>

					{action && <ActionPanel action={action} onDecide={answer} />}

					<div className="layout">
						<ol className="steps" aria-label="Steps">
							{steps.map((s) => (
								<li key={s.id}>
									<button className={s.id === current?.id ? "step active" : "step"} onClick={() => setSelected(s.id)}>
										<span className={`dot ${s.status}`} aria-label={s.status} />
										{s.title}
										<small>{s.http.length} request{s.http.length === 1 ? "" : "s"}</small>
									</button>
								</li>
							))}
						</ol>
						<section className="detail">
							{current ? (
								<>
									<h2>{current.title}</h2>
									{current.error && <pre className="error">{current.error}</pre>}
									{current.summary.length > 0 && (
										<ul className="summary">
											{current.summary.map((l, i) => (
												<li key={i}>{l}</li>
											))}
										</ul>
									)}
									{current.http.map((h, i) => (
										<Exchange key={i} http={h} />
									))}
								</>
							) : (
								<p className="note">Run the journey to see each request the agent makes to the target.</p>
							)}
						</section>
					</div>
				</>
			)}
		</main>
	);
}
