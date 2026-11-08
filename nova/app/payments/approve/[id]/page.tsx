import { revalidatePath } from "next/cache";
import { poppyseed } from "../../../../poppyseed.config";
import { viewer } from "../../../../lib/viewer";
import { AgentBanner, NoCustomer } from "../../../agent-banner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approve a payment" };

/**
 * Where the customer approves what their personal agent staged. Only the customer's own browser can: an agent's Session
 * is refused here and in the action, so an agent can never approve its own proposal. The operation must be this
 * customer's, or the page says there is nothing to approve.
 */
export default async function Approve({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const who = await viewer();
	if (who.via !== "site") {
		return (
			<main>
				<header className="hero"><h1>Approve a payment</h1></header>
				<AgentBanner viewer={who} />
				{who.via === "visitor" ? <NoCustomer viewer={who} /> : who.via === "agent" ? <p className="card">Only the customer, in their own browser, can approve a payment. Ask them to open this page.</p> : <p className="card"><a href={`/login?return_to=/payments/approve/${encodeURIComponent(id)}`}>Sign in</a> to approve this payment.</p>}
			</main>
		);
	}
	const op = await poppyseed.operations.get(id, who.customer.id);
	async function approve(form: FormData) {
		"use server";
		const now = await viewer();
		// Only the customer's own browser, checked again: an action can be called without the page.
		if (now.via !== "site") return revalidatePath(`/payments/approve/${id}`);
		await poppyseed.operations.approve(id, now.customer.id, Number(form.get("revision"))).catch(() => undefined);
		revalidatePath(`/payments/approve/${id}`);
	}
	return (
		<main>
			<header className="hero">
				<p className="kicker">Signed in as {who.customer.email}</p>
				<h1>Approve a payment</h1>
			</header>
			{!op ? (
				<p className="card">There is nothing to approve here. It may belong to another customer, or it has been removed.</p>
			) : (
				<section className="card" aria-labelledby="what">
					<h2 id="what">{op.state === "proposed" ? "Your personal agent is asking to:" : "Your personal agent asked to:"}</h2>
					<p>{op.summary}</p>
					{op.state === "proposed" && (
						<form action={approve}>
							<input type="hidden" name="revision" value={op.revision} />
							<button type="submit">Approve</button>
							<p className="muted">Nothing happens until you approve. This offer lapses on its own at {op.expires_at ? new Date(op.expires_at).toLocaleTimeString("en-ZA") : "its expiry"}.</p>
						</form>
					)}
					{op.state === "in_progress" && <p role="status">Approved. It is being processed.</p>}
					{(op.state === "succeeded" || op.state === "failed") && <p role="status">{op.result?.summary}</p>}
					{op.state === "cancelled" && <p role="status">Cancelled. Nothing was done.</p>}
					{op.state === "expired" && <p role="status">This offer lapsed before it was approved. Nothing was done. Ask your agent to set it up again.</p>}
				</section>
			)}
		</main>
	);
}
