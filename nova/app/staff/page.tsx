import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { poppyseed } from "../../poppyseed.config";
import { isStaff } from "../../lib/staff";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support", robots: { index: false } };

/**
 * The support team's inbox for handoffs from personal agents. Open it with ?key= and the value of POPPY_STAFF_KEY.
 * There is no default key in production: without the variable the page does not exist.
 */
export default async function Staff({ searchParams }: { searchParams: Promise<{ key?: string; id?: string }> }) {
	const { key, id } = await searchParams;
	if (!isStaff(key)) notFound();
	const queue = await poppyseed.conversations.queue();
	const open = id ? await poppyseed.conversations.get(id) : undefined;
	const here = `/staff?key=${encodeURIComponent(key)}`;

	// The actions use the imported instance and capture nothing: Next serializes what a server action closes over, and an object of functions cannot be.
	// Each action checks the key itself: an action can be called without loading the page, so the page's check does not cover it.
	async function join(form: FormData) {
		"use server";
		if (!isStaff(form.get("key"))) throw new Error("not allowed");
		await poppyseed.conversations.join(String(form.get("id")));
		revalidatePath("/staff");
	}
	async function reply(form: FormData) {
		"use server";
		if (!isStaff(form.get("key"))) throw new Error("not allowed");
		await poppyseed.conversations.reply(String(form.get("id")), String(form.get("text")), { author: { id: "aut_support", name: "Nova Bank support" } });
		revalidatePath("/staff");
	}
	async function release(form: FormData) {
		"use server";
		if (!isStaff(form.get("key"))) throw new Error("not allowed");
		await poppyseed.conversations.release(String(form.get("id")));
		revalidatePath("/staff");
	}

	return (
		<main>
			<header className="hero">
				<p className="kicker">Support</p>
				<h1>Agent handoffs</h1>
			</header>
			<section aria-labelledby="waiting">
				<h2 id="waiting">Waiting</h2>
				{queue.length === 0 && <p className="muted">Nobody is waiting.</p>}
				<div className="card scroll">
					<table className="table">
						<tbody>
							{queue.map((c) => (
								<tr key={c.id}>
									<td><a href={`${here}&id=${c.id}`}>{c.id}</a></td>
									<td className="muted">{c.messages.at(-1)?.text?.slice(0, 80)}</td>
									<td>
										<form action={join}>
											<input type="hidden" name="id" value={c.id} />
											<input type="hidden" name="key" value={key} />
											<button type="submit">Take it</button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
			{open && (
				<section aria-labelledby="open">
					<h2 id="open">{open.id} <span className="muted">{open.responder}, {open.status}</span></h2>
					<div className="card">
						{open.messages.map((m) => (
							<p key={m.id}>
								<strong>{m.role === "user" ? (m.author.type === "human" ? "Customer" : "Customer's agent") : m.author.type === "human" ? "Staff" : "Nova assistant"}</strong>
								<br />
								{m.text}
							</p>
						))}
					</div>
					<form action={reply} className="card">
						<input type="hidden" name="id" value={open.id} />
						<input type="hidden" name="key" value={key} />
						<textarea name="text" rows={3} required placeholder="Write to the customer" style={{ width: "100%", font: "inherit" }} />
						<button type="submit">Send</button>
					</form>
					<form action={release}>
						<input type="hidden" name="id" value={open.id} />
						<input type="hidden" name="key" value={key} />
						<button type="submit" className="secondary">Hand back to the assistant</button>
					</form>
				</section>
			)}
		</main>
	);
}
