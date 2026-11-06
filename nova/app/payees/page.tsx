import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addPayee, payeesOf } from "../../lib/bank";
import { customerOf, mayRead, viewer } from "../../lib/viewer";
import { AgentBanner, NeedScope, NoCustomer } from "../agent-banner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payees" };

/**
 * Saved payees. A customer in their own browser can add one here. Adding a payee is a task Protea Bank does not offer
 * a personal agent (lib/excluded.ts), so while an agent's Session is viewing, there is no form, and the action refuses
 * even if someone posts to it: the page's check does not cover an action called on its own.
 */
export default async function Payees({ searchParams }: { searchParams: Promise<{ added?: string; error?: string }> }) {
	const who = await viewer();
	const { added, error } = await searchParams;
	const customer = customerOf(who);
	if (!customer) {
		return (
			<main>
				<header className="hero"><h1>Payees</h1></header>
				<AgentBanner viewer={who} />
				{who.via === "visitor" ? <NoCustomer viewer={who} /> : who.via === "agent" ? <p className="card">This session has not signed in to Protea Bank.</p> : <p className="card"><a href="/login?return_to=/payees">Sign in</a> to manage your payees.</p>}
			</main>
		);
	}
	async function add(form: FormData) {
		"use server";
		const now = await viewer();
		// Only the customer's own browser. An agent's Session, signed in or not, is refused.
		if (now.via !== "site") return revalidatePath("/payees");
		const result = addPayee(now.customer.id, String(form.get("name") ?? ""), String(form.get("account") ?? ""));
		redirect(result.ok ? `/payees?added=${encodeURIComponent(result.payee.name)}` : `/payees?error=${encodeURIComponent(result.reason)}`);
	}
	return (
		<main>
			<AgentBanner viewer={who} />
			<header className="hero">
				<p className="kicker">Signed in as {customer.email}</p>
				<h1>Payees</h1>
				<p className="lede">The people and companies a payment can go to. Your personal agent can pay a payee you have saved. It can't add one: you do that yourself.</p>
			</header>
			<section aria-labelledby="saved">
				<h2 id="saved">Saved payees</h2>
				{!mayRead(who, "payments:write") ? (
					<NeedScope viewer={who} scope="payments:write" what="your saved payees" />
				) : (
					<div className="card scroll">
						<table className="table">
							<thead>
								<tr><th>Payee</th><th>Account</th></tr>
							</thead>
							<tbody>
								{payeesOf(customer.id).map((p) => (
									<tr key={p.id}><td><strong>{p.name}</strong></td><td className="num">••{p.endingDigits}</td></tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
			{who.via === "site" ? (
				<section aria-labelledby="add">
					<h2 id="add">Add a payee</h2>
					{added && <p className="card" role="status">Saved {added}.</p>}
					{error && <p className="card" role="alert">{error}</p>}
					<form action={add} className="card">
						<label>Name<br /><input name="name" required minLength={2} maxLength={60} autoComplete="off" /></label>
						<label>Account number<br /><input name="account" required inputMode="numeric" pattern="[0-9 \-]{6,16}" autoComplete="off" /></label>
						<button type="submit">Save payee</button>
					</form>
				</section>
			) : (
				<section aria-labelledby="add">
					<h2 id="add">Add a payee</h2>
					<p className="card" data-excluded-task="Add a new payee">Adding a payee isn't something Protea Bank offers a personal agent. Ask the customer to add it in their own browser, or at a branch in Paarl or Pretoria. Once it is saved, an agent can pay it.</p>
				</section>
			)}
		</main>
	);
}
