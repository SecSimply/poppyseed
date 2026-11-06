import type { Viewer } from "../lib/viewer";

/** Says on the page that an agent's Session is looking, as whom, and with which scopes. Nothing for a customer's own browser. */
export function AgentBanner({ viewer }: { viewer: Viewer }) {
	if (viewer.via !== "agent") return null;
	return (
		<p className="card" role="note">
			<strong>A personal agent is viewing this page.</strong> {new URL(viewer.clientId).hostname}
			{viewer.customer ? <> is signed in as {viewer.customer.name}</> : <> has not signed in</>} with {viewer.scopes.length ? viewer.scopes.join(", ") : "no scopes"}. The page shows only what those scopes allow.
		</p>
	);
}

/** A section the viewer may not read. It names the scope, so the agent can ask for it. */
export function NeedScope({ viewer, scope, what }: { viewer: Viewer; scope: string; what: string }) {
	return (
		<p className="card" data-needs-scope={scope}>
			{viewer.via === "agent" && !viewer.customer ? "Sign in to see " : "Your session can't see "}
			{what}. It needs the <code>{scope}</code> scope.
		</p>
	);
}
