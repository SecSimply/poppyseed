import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { poppyseed } from "../../poppyseed.config";
import { entries, record } from "../../lib/audit";
import { block, blocked, unblock } from "../../lib/blocklist";
import { CUSTOMERS, customerById } from "../../lib/customers";
import { reports } from "../../lib/feedback";
import { links } from "../../lib/links";
import { oidc } from "../../lib/oidc";
import { sessionFrom } from "../../lib/session";
import { mayLink, staffAccess } from "../../lib/staff";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support", robots: { index: false } };

/** Who is acting, checked afresh by every action: an action can be called without loading the page, so the page's check does not cover it. */
async function actor(form: FormData) {
	const who = staffAccess((await cookies()).toString(), form.get("key"));
	if (!who) throw new Error("not allowed");
	return who;
}

/**
 * Who may link a login to a customer. A link opens that customer's accounts to the login, so it takes a staff member
 * signed in with Curity: the emergency key, which could be leaked, does not.
 */
async function linker(form: FormData) {
	const who = await actor(form);
	if (!mayLink(who)) throw new Error("linking needs a staff sign-in");
	return who;
}

/**
 * The support team's console: handoffs from personal agents, blocked agents and agents' reports. Staff sign in with
 * Curity (Staff in the menu); anyone not on STAFF_EMAILS is told so. The emergency key, ?key= with the value of
 * POPPY_STAFF_KEY, still opens it when Curity is unavailable.
 */
export default async function Staff({ searchParams }: { searchParams: Promise<{ key?: string; id?: string }> }) {
	const { key, id } = await searchParams;
	const cookieHeader = (await cookies()).toString();
	const who = staffAccess(cookieHeader, key);
	if (!who) {
		const session = sessionFrom(cookieHeader);
		if (!session) return oidc ? redirect("/auth/login?as=staff&return_to=/staff") : notFound();
		return (
			<main>
				<header className="hero">
					<p className="kicker">Support</p>
					<h1>Not on the staff list</h1>
					<p className="lede">You are signed in as {session.email ?? session.name ?? "a customer"}, which is not a member of staff. Someone at the bank adds staff by hand. If that should be you, ask them to add this address.</p>
				</header>
				<form action="/auth/logout" method="post"><button type="submit" className="secondary">Sign out of Protea Bank</button></form>
			</main>
		);
	}
	const queue = await poppyseed.conversations.queue();
	const [pendingLogins, linkedLogins] = await Promise.all([(await links()).pending(), (await links()).linked()]);
	const open = id ? await poppyseed.conversations.get(id) : undefined;
	// The key travels in forms and links only when it is how this person got in.
	const keyField = who.by === "key" && typeof key === "string" ? key : "";
	const here = who.by === "key" ? `/staff?key=${encodeURIComponent(keyField)}&` : "/staff?";

	// The actions use the imported instance and capture nothing: Next serializes what a server action closes over, and an object of functions cannot be.
	async function join(form: FormData) {
		"use server";
		const me = await actor(form);
		await poppyseed.conversations.join(String(form.get("id")));
		record(me, `took ${String(form.get("id"))}`);
		revalidatePath("/staff");
	}
	async function reply(form: FormData) {
		"use server";
		const me = await actor(form);
		await poppyseed.conversations.reply(String(form.get("id")), String(form.get("text")), { author: { id: me.id, name: me.name } });
		record(me, `replied in ${String(form.get("id"))}`);
		revalidatePath("/staff");
	}
	async function release(form: FormData) {
		"use server";
		const me = await actor(form);
		await poppyseed.conversations.release(String(form.get("id")));
		record(me, `handed ${String(form.get("id"))} back to the assistant`);
		revalidatePath("/staff");
	}
	async function blockClient(form: FormData) {
		"use server";
		const me = await actor(form);
		const client = String(form.get("client_id") ?? "");
		if (block(client)) record(me, `blocked ${client}`);
		revalidatePath("/staff");
	}
	async function unblockClient(form: FormData) {
		"use server";
		const me = await actor(form);
		const client = String(form.get("client_id") ?? "");
		unblock(client);
		record(me, `unblocked ${client}`);
		revalidatePath("/staff");
	}

	async function linkLogin(form: FormData) {
		"use server";
		const me = await linker(form);
		const store = await links();
		const sub = String(form.get("sub") ?? "");
		const customer = customerById(String(form.get("customer") ?? ""));
		// Only a login that has signed in and is waiting, with the email and name it signed in with.
		const waiting = (await store.pending()).find((p) => p.sub === sub);
		if (waiting && customer) {
			await store.link(waiting, customer.id, me.name);
			record(me, `linked ${waiting.email ?? waiting.sub} to ${customer.id}`);
		}
		revalidatePath("/staff");
	}
	async function unlinkLogin(form: FormData) {
		"use server";
		const me = await linker(form);
		const store = await links();
		const sub = String(form.get("sub") ?? "");
		const was = (await store.linked()).find((l) => l.sub === sub);
		if (was) {
			await store.unlink(sub);
			record(me, `unlinked ${was.email ?? was.sub} from ${was.customerId}`);
		}
		revalidatePath("/staff");
	}

	return (
		<main>
			<header className="hero">
				<p className="kicker">Support · {who.name}{who.by === "key" ? " (emergency key)" : ""}</p>
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
									<td><a href={`${here}id=${c.id}`}>{c.id}</a></td>
									<td className="muted">{c.messages.at(-1)?.text?.slice(0, 80)}</td>
									<td>
										<form action={join}>
											<input type="hidden" name="id" value={c.id} />
											<input type="hidden" name="key" value={keyField} />
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
						<input type="hidden" name="key" value={keyField} />
						<textarea name="text" rows={3} required placeholder="Write to the customer" style={{ width: "100%", font: "inherit" }} />
						<button type="submit">Send</button>
					</form>
					<form action={release}>
						<input type="hidden" name="id" value={open.id} />
						<input type="hidden" name="key" value={keyField} />
						<button type="submit" className="secondary">Hand back to the assistant</button>
					</form>
				</section>
			)}
			<section aria-labelledby="logins">
				<h2 id="logins">Customer logins</h2>
				<p className="muted">A login that signs in to Protea Bank sees no accounts until you link it to a customer. A link gives that login the customer's accounts, so link one only when you know the person. Unlinking takes effect at the login's next request.{!mayLink(who) ? " Linking needs a staff sign-in with Curity; the emergency key can only look." : ""}</p>
				<div className="card scroll">
					<h3>Waiting to be linked</h3>
					{pendingLogins.length === 0 && <p className="muted">No login is waiting.</p>}
					{pendingLogins.map((p) => (
						<form action={linkLogin} key={p.sub}>
							<input type="hidden" name="sub" value={p.sub} />
							<input type="hidden" name="key" value={keyField} />
							<strong>{p.email ?? "no email"}</strong> <span className="muted">{p.name ?? ""} · {p.seenAt.slice(0, 16).replace("T", " ")}</span>{" "}
							{mayLink(who) && (
								<>
									<select name="customer" required defaultValue="">
										<option value="" disabled>Customer…</option>
										{CUSTOMERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
									</select>
									<button type="submit">Link</button>
								</>
							)}
						</form>
					))}
					<h3>Linked</h3>
					{linkedLogins.length === 0 && <p className="muted">No login is linked.</p>}
					{linkedLogins.map((l) => (
						<form action={unlinkLogin} key={l.sub}>
							<input type="hidden" name="sub" value={l.sub} />
							<input type="hidden" name="key" value={keyField} />
							<strong>{l.email ?? "no email"}</strong> <span className="muted">is {customerById(l.customerId)?.name ?? l.customerId} · linked by {l.linkedBy}</span>{" "}
							{mayLink(who) && <button type="submit" className="secondary">Unlink</button>}
						</form>
					))}
				</div>
			</section>
			<section aria-labelledby="blocked">
				<h2 id="blocked">Blocked agents</h2>
				<p className="muted">A personal agent is refused by its client_id, the URL of its metadata. It stops at its next Session: one it already has runs until its token expires. The list is kept in memory and goes back to the BLOCKED_CLIENTS variable on a restart.</p>
				<div className="card">
					{blocked.length === 0 && <p className="muted">No agent is blocked.</p>}
					{blocked.map((id) => (
						<form action={unblockClient} key={id}>
							<code>{id}</code>
							<input type="hidden" name="client_id" value={id} />
							<input type="hidden" name="key" value={keyField} />
							<button type="submit" className="secondary">Unblock</button>
						</form>
					))}
					<form action={blockClient}>
						<input type="hidden" name="key" value={keyField} />
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
			<section aria-labelledby="log">
				<h2 id="log">What staff have done</h2>
				{entries.length === 0 && <p className="muted">Nothing yet.</p>}
				<div className="card scroll">
					<table className="table">
						<tbody>
							{entries.slice(0, 20).map((e) => (
								<tr key={`${e.at}${e.what}`}>
									<td className="num">{e.at.slice(0, 16).replace("T", " ")}</td>
									<td>{e.who}{e.by === "key" ? <span className="muted"> (key)</span> : null}</td>
									<td>{e.what}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
			{who.by === "session" && (
				<form action="/auth/logout" method="post">
					<button type="submit" className="secondary">Sign out of Protea Bank</button>
				</form>
			)}
		</main>
	);
}
