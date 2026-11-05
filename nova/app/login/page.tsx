import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CUSTOMERS, SITE_COOKIE } from "../../lib/customers";
import { safeReturn } from "../../lib/return-to";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

/** Nova Bank's own sign-in (a demonstration: pick a customer). Consent pages send people here and back. */
export default async function Login({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
	const { return_to } = await searchParams;
	async function signIn(form: FormData) {
		"use server";
		(await cookies()).set(SITE_COOKIE, String(form.get("customer")), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
		// Only return to a page on this site.
		redirect(safeReturn(String(form.get("return_to") ?? ""), process.env.POPPYSEED_BASE_URL ?? "http://localhost:3000"));
	}
	return (
		<main>
			<header className="hero">
				<p className="kicker">Nova Bank</p>
				<h1>Sign in</h1>
				<p className="lede">A demonstration sign-in with no password. Choose one of the two fictional customers.</p>
			</header>
			<form action={signIn} className="card">
				<input type="hidden" name="return_to" value={return_to ?? "/account"} />
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
