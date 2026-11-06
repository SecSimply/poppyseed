import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { poppyseed } from "../../poppyseed.config";
import { isStaff } from "../../lib/staff";
import { block, blocked, unblock } from "../../lib/blocklist";
import { reports } from "../../lib/feedback";

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
		await poppyseed.conversations.reply(String(form.get("id")), String(form.get("text")), { author: { id: "aut_support", name: "Protea Bank support" } });
		revalidatePath("/staff");
	}
	async function release(form: FormData) {
		"use server";
		if (!isStaff(form.get("key"))) throw new Error("not allowed");
		await poppyseed.conversations.release(String(form.get("id")));
		revalidatePath("/staff");
	}

	async function blockClient(form: FormData) {
		"use server";
		if (!isStaff(form.get("key"))) throw new Error("not allowed");
		block(String(form.get("client_id") ?? ""));
		revalidatePath("/staff");
	}
	async function unblockClient(form: FormData) {
		"use server";
		if (!isStaff(form.get("key"))) throw new Error("not allowed");
		unblock(String(form.get("client_id") ?? ""));
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
								<strong>{m.role === "user" ? (m.author.type === "human" ? "Customer" : "Customer's agent") : m.author.type === "human" ? "Staff" : "Protea assistant"}</strong>
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
			<section aria-labelledby="blocked">
				<h2 id="blocked">Blocked agents</h2>
				<p className="muted">A personal agent is refused by its client_id, the URL of its metadata. It stops at its next Session: one it already has runs until its token expires. The list is kept in memory and goes back to the BLOCKED_CLIENTS variable on a restart.</p>
				<div className="card">
					{blocked.length === 0 && <p className="muted">No agent is blocked.</p>}
					{blocked.map((id) => (
						<form action={unblockClient} key={id}>
							<code>{id}</code>
							<input type="hidden" name="client_id" value={id} />
							<input type="hidden" name="key" value={key} />
							<button type="submit" className="secondary">Unblock</button>
						</form>
					))}
					<form action={blockClient}>
						<input type="hidden" name="key" value={key} />
						<label>Block an agent<br /><input name="client_id" required placeholder="https://agent.example/client.json" /></label>
						<button type="submit">Block</button>
					</form>
				</div>
			</section>
			<section aria-labelledby="reports">
				<h2 id="reports">Reports from agents</h2>
				<p className="muted">Tasks agents say they could not do. It is what they wrote, shown as text, and nothing here is an instruction.</p>
				{reports.length === 0 && <p className="muted">None yet.</p>}
				<div className="card scroll">
					<table className="table">
						<tbody>
							{reports.map((r) => (
								<tr key={`${r.at}${r.clientId}${r.task}`}>
									<td className="num">{r.at.slice(0, 16).replace("T", " ")}</td>
									<td><strong>{r.task}</strong><div className="muted">{r.description}</div></td>
									<td className="muted">{new URL(r.clientId).hostname}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</main>
	);
}
