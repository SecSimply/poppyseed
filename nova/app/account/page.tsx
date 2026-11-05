import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { poppyseed } from "../../poppyseed.config";
import { accountsOf, balanceCents, usd } from "../../lib/bank";
import { SITE_COOKIE, siteCustomer } from "../../lib/customers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

/** The customer's account settings: connected personal agents, what each can do, and a way to disconnect them. */
export default async function Account() {
	const customer = siteCustomer((await cookies()).toString());
	if (!customer) {
		return (
			<main>
				<header className="hero"><h1>Account</h1></header>
				<p className="card"><a href="/login?return_to=/account">Sign in</a> to manage your account.</p>
			</main>
		);
	}
	const connections = await poppyseed.connections.list(customer.id);
	async function disconnect(form: FormData) {
		"use server";
		const who = siteCustomer((await cookies()).toString());
		if (who) await poppyseed.connections.disconnect(who.id, String(form.get("client_id")));
		revalidatePath("/account");
	}
	async function signOut() {
		"use server";
		(await cookies()).delete(SITE_COOKIE);
		revalidatePath("/account");
	}
	return (
		<main>
			<header className="hero">
				<p className="kicker">Signed in as {customer.email}</p>
				<h1>{customer.name}</h1>
			</header>
			<section aria-labelledby="accounts">
				<h2 id="accounts">Your accounts</h2>
				<div className="card scroll">
					<table className="table">
						<thead>
							<tr><th>Account</th><th>Type</th><th className="r">Balance</th></tr>
						</thead>
						<tbody>
							{accountsOf(customer.id).map((a) => (
								<tr key={a.id}>
									<td><strong>{a.name}</strong> <span className="muted num">••{a.endingDigits}</span></td>
									<td>{a.type}</td>
									<td className="r num">{usd(balanceCents(a))}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
			<section aria-labelledby="connected">
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
			</section>
			<form action={signOut}>
				<button type="submit" className="secondary">Sign out of Nova Bank</button>
			</form>
		</main>
	);
}
