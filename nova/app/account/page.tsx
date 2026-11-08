import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { poppyseed } from "../../poppyseed.config";
import { accountsOf, balanceCents, zar } from "../../lib/bank";
import { siteCustomer } from "../../lib/customers";
import { sessionFrom } from "../../lib/session";
import { customerOf, mayRead, viewer } from "../../lib/viewer";
import { AgentBanner, NeedScope, NoCustomer } from "../agent-banner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

/** The customer's account settings: connected personal agents, what each can do, and a way to disconnect them. */
export default async function Account() {
	const who = await viewer();
	const customer = customerOf(who);
	if (!customer) {
		return (
			<main>
				<header className="hero"><h1>Account</h1></header>
				<AgentBanner viewer={who} />
				{who.via === "visitor" ? <NoCustomer viewer={who} /> : who.via === "agent" ? <p className="card">This session has not signed in to Protea Bank. Ask the customer to approve a sign-in with the <code>accounts:read</code> scope.</p> : <p className="card"><a href="/login?return_to=/account">Sign in</a> to manage your account.</p>}
			</main>
		);
	}
	// Connected agents and sign-out belong to the customer in their own browser; an agent's browser sees neither.
	const connections = who.via === "site" ? await poppyseed.connections.list(customer.id) : [];
	async function disconnect(form: FormData) {
		"use server";
		const who = await siteCustomer((await cookies()).toString());
		if (who) await poppyseed.connections.disconnect(who.id, String(form.get("client_id")));
		revalidatePath("/account");
	}
	return (
		<main>
			<AgentBanner viewer={who} />
			<header className="hero">
				<p className="kicker">Signed in as {customer.email}</p>
				<h1>{customer.name}</h1>
			</header>
			<section aria-labelledby="accounts">
				<h2 id="accounts">Your accounts</h2>
				{!mayRead(who, "accounts:read") ? <NeedScope viewer={who} scope="accounts:read" what="your accounts and balances" /> : <div className="card scroll">
					<table className="table">
						<thead>
							<tr><th>Account</th><th>Type</th><th className="r">Balance</th></tr>
						</thead>
						<tbody>
							{accountsOf(customer.id).map((a) => (
								<tr key={a.id}>
									<td><strong>{a.name}</strong> <span className="muted num">••{a.endingDigits}</span></td>
									<td>{a.type}</td>
									<td className="r num">{zar(balanceCents(a))}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>}
			</section>
			{who.via === "site" && <section aria-labelledby="connected">
				<h2 id="connected">Connected personal agents</h2>
				{connections.length === 0 ? (
					<p className="muted">No personal agents are connected.</p>
				) : (
					<div className="card scroll">
						<table className="table">
							<tbody>
								{connections.map((c) => (
									<tr key={c.clientId}>
										<th scope="row">{c.clientName ?? "Personal agent"}</th>
										<td>
											<div className="muted">{new URL(c.clientId).hostname}</div>
											<div>{c.scopes.join(", ")}</div>
											<div className="muted">Last used {new Date(c.lastUsedAt).toLocaleString("en-US")}</div>
											<form action={disconnect}>
												<input type="hidden" name="client_id" value={c.clientId} />
												<button type="submit" className="secondary">Disconnect</button>
											</form>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>}
			{who.via === "site" && <form action="/auth/logout" method="post">
				<button type="submit" className="secondary">Sign out of Protea Bank</button>
			</form>}
		</main>
	);
}
