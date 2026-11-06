import { accountsOf, TRANSACTIONS, zar } from "../../lib/bank";
import { mayRead, viewer } from "../../lib/viewer";
import { AgentBanner, NeedScope } from "../agent-banner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };


/** The customer's recent payments and transfers, including any their personal agent made. */
export default async function Payments() {
	const who = await viewer();
	const customer = who.via === "nobody" ? undefined : who.customer;
	if (!customer) {
		return (
			<main>
				<header className="hero"><h1>Payments</h1></header>
				<AgentBanner viewer={who} />
				{who.via === "agent" ? <p className="card">This session has not signed in to Protea Bank. Ask the customer to approve a sign-in with the <code>transactions:read</code> scope.</p> : <p className="card"><a href="/login?return_to=/payments">Sign in</a> to see your payments.</p>}
			</main>
		);
	}
	const accounts = accountsOf(customer.id);
	const rows = TRANSACTIONS.filter((t) => (t.category === "payment" || t.category === "transfer") && accounts.some((a) => a.id === t.accountId))
		.sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
		.slice(0, 30);
	return (
		<main>
			<AgentBanner viewer={who} />
			<header className="hero">
				<p className="kicker">Signed in as {customer.email}</p>
				<h1>Payments</h1>
				<p className="lede">Payments and transfers from your accounts. A payment your personal agent proposes over its limit waits for your own approval before it appears here.</p>
			</header>
			<section aria-labelledby="recent">
				<h2 id="recent">Recent</h2>
				{!mayRead(who, "transactions:read") ? <NeedScope viewer={who} scope="transactions:read" what="your payments" /> : <div className="card scroll">
					<table className="table">
						<thead>
							<tr><th>Date</th><th>Account</th><th>Description</th><th className="r">Amount</th></tr>
						</thead>
						<tbody>
							{rows.length === 0 && <tr><td colSpan={4} className="muted">Nothing yet.</td></tr>}
							{rows.map((t) => {
								const a = accounts.find((x) => x.id === t.accountId)!;
								return (
									<tr key={t.id}>
										<td className="num">{t.date}</td>
										<td>{a.name} <span className="muted num">••{a.endingDigits}</span></td>
										<td>{t.description}</td>
										<td className="r num">{zar(t.cents)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>}
			</section>
		</main>
	);
}
