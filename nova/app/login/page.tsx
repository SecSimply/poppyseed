import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CUSTOMERS, customerById } from "../../lib/customers";
import { baseUrl, secure } from "../../lib/env";
import { oidc } from "../../lib/oidc";
import { safeReturn } from "../../lib/return-to";
import { viewer } from "../../lib/viewer";
import { NoCustomer } from "../agent-banner";
import { SESSION_COOKIE, SESSION_HOURS, sealSession } from "../../lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

/**
 * Where consent pages and the menu send a customer to sign in. With Curity configured it goes straight to Curity. On a
 * local http site with none, it is a demonstration sign-in: pick one of the two fictional customers, no password.
 */
export default async function Login({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
	const { return_to } = await searchParams;
	const returnTo = safeReturn(return_to, baseUrl);
	const who = await viewer();
	// Signed in at Curity already, but not as a customer: going back to Curity would only bring them here again.
	if (who.via === "visitor") return <main><header className="hero"><h1>Sign in</h1></header><NoCustomer viewer={who} /></main>;
	if (oidc) redirect(`/auth/login?as=customer&return_to=${encodeURIComponent(returnTo)}`);
	async function signIn(form: FormData) {
		"use server";
		// The demonstration login exists only where there is no Curity: it must never run on a deployed https site.
		if (secure) throw new Error("not available");
		const customer = customerById(String(form.get("customer")));
		if (!customer) throw new Error("unknown customer");
		(await cookies()).set(SESSION_COOKIE, sealSession({ sub: `demo:${customer.id}`, email: customer.email, name: customer.name, customerId: customer.id, staff: false }), { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: SESSION_HOURS.customer * 3600 });
		redirect(safeReturn(String(form.get("return_to") ?? ""), baseUrl));
	}
	return (
		<main>
			<header className="hero">
				<p className="kicker">Protea Bank</p>
				<h1>Sign in</h1>
				<p className="lede">A demonstration sign-in with no password, because Curity is not set up here. Choose one of the two fictional customers.</p>
			</header>
			<form action={signIn} className="card">
				<input type="hidden" name="return_to" value={returnTo} />
				{CUSTOMERS.map((c, i) => (
					<label key={c.id} className="choice">
						<input type="radio" name="customer" value={c.id} defaultChecked={i === 0} /> {c.name} <span className="muted">{c.email}</span>
					</label>
				))}
				<button type="submit">Sign in</button>
			</form>
		</main>
	);
}
