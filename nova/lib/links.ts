/**
 * Which Curity login is which customer. A link is made by staff and is keyed
 * by the login's `sub`, which the provider never reuses, not by an email anyone could claim. A login that signs in
 * with no link is noted as pending, so staff can see it and link it. In Postgres when DATABASE_URL is set, in memory
 * otherwise (local development and tests).
 */
import { database, type SqlClient } from "./db.ts";

export interface Who {
	sub: string;
	email?: string;
	name?: string;
}
export interface Link extends Who {
	customerId: string;
	/** Who made the link: a staff member's name. */
	linkedBy: string;
	linkedAt: string;
}
export interface Pending extends Who {
	seenAt: string;
}

export interface Links {
	customerFor(sub: string): Promise<string | undefined>;
	link(who: Who, customerId: string, by: string): Promise<void>;
	/** Removes the link and the login's pending note. The login then has no accounts at its next request. */
	unlink(sub: string): Promise<void>;
	/** Notes a login that has no link, replacing its earlier note. Keeps the newest 50. */
	notePending(who: Who): Promise<void>;
	linked(): Promise<Link[]>;
	pending(): Promise<Pending[]>;
}

const MAX_PENDING = 50;

export function memoryLinks(): Links {
	const links = new Map<string, Link>();
	const pending = new Map<string, Pending>();
	return {
		async customerFor(sub) {
			return links.get(sub)?.customerId;
		},
		async link(who, customerId, by) {
			links.set(who.sub, { ...who, customerId, linkedBy: by, linkedAt: new Date().toISOString() });
			pending.delete(who.sub);
		},
		async unlink(sub) {
			links.delete(sub);
			pending.delete(sub);
		},
		async notePending(who) {
			pending.delete(who.sub);
			pending.set(who.sub, { ...who, seenAt: new Date().toISOString() });
			while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
		},
		async linked() {
			return [...links.values()].sort((a, b) => b.linkedAt.localeCompare(a.linkedAt));
		},
		async pending() {
			return [...pending.values()].reverse();
		},
	};
}

export function postgresLinks(db: SqlClient): Links {
	let ready: Promise<unknown> | undefined;
	const schema = () =>
		(ready ??= Promise.all([
			db.query(`create table if not exists nova_customer_links (sub text primary key, email text, name text, customer_id text not null, linked_by text not null, linked_at timestamptz not null default now())`),
			db.query(`create table if not exists nova_pending_logins (sub text primary key, email text, name text, seen_at timestamptz not null default now())`),
		]));
	const text = (v: unknown) => (typeof v === "string" ? v : undefined);
	const who = (r: Record<string, unknown>): Who => ({ sub: String(r.sub), ...(text(r.email) ? { email: text(r.email) } : {}), ...(text(r.name) ? { name: text(r.name) } : {}) });
	const iso = (v: unknown) => new Date(v as string | Date).toISOString();
	return {
		async customerFor(sub) {
			await schema();
			return text((await db.query(`select customer_id from nova_customer_links where sub = $1`, [sub])).rows[0]?.customer_id);
		},
		async link(w, customerId, by) {
			await schema();
			await db.query(
				`insert into nova_customer_links (sub, email, name, customer_id, linked_by) values ($1, $2, $3, $4, $5)
				 on conflict (sub) do update set email = $2, name = $3, customer_id = $4, linked_by = $5, linked_at = now()`,
				[w.sub, w.email ?? null, w.name ?? null, customerId, by],
			);
			await db.query(`delete from nova_pending_logins where sub = $1`, [w.sub]);
		},
		async unlink(sub) {
			await schema();
			await db.query(`delete from nova_customer_links where sub = $1`, [sub]);
			await db.query(`delete from nova_pending_logins where sub = $1`, [sub]);
		},
		async notePending(w) {
			await schema();
			await db.query(
				`insert into nova_pending_logins (sub, email, name) values ($1, $2, $3)
				 on conflict (sub) do update set email = $2, name = $3, seen_at = now()`,
				[w.sub, w.email ?? null, w.name ?? null],
			);
			await db.query(`delete from nova_pending_logins where sub in (select sub from nova_pending_logins order by seen_at desc offset ${MAX_PENDING})`);
		},
		async linked() {
			await schema();
			return (await db.query(`select * from nova_customer_links order by linked_at desc`)).rows.map((r) => ({ ...who(r), customerId: String(r.customer_id), linkedBy: String(r.linked_by), linkedAt: iso(r.linked_at) }));
		},
		async pending() {
			await schema();
			return (await db.query(`select * from nova_pending_logins order by seen_at desc`)).rows.map((r) => ({ ...who(r), seenAt: iso(r.seen_at) }));
		},
	};
}

declare global {
	var __proteaLinks: Links | undefined;
}

/**
 * The links in use. In production Postgres is required: without it every link would vanish on a restart and every
 * customer would see no accounts, so the first use fails loudly instead.
 */
export async function links(env: Record<string, string | undefined> = process.env): Promise<Links> {
	if (globalThis.__proteaLinks) return globalThis.__proteaLinks;
	const db = await database(env);
	if (db) return (globalThis.__proteaLinks = postgresLinks(db));
	if (env.NODE_ENV === "production") throw new Error("DATABASE_URL is not set: Protea Bank cannot tell which login is which customer");
	return (globalThis.__proteaLinks = memoryLinks());
}
