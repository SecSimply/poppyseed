/**
 * The phones customers approve agent payments on. A customer opens an enrollment on the website (a QR code with a
 * one-time secret); the app claims it with two public keys it made in the phone's secure hardware, which leaves a
 * device waiting for the customer to confirm a code on the website; confirmed, it is active. Each customer has at most one
 * live (waiting or active) device: the Postgres schema says so, so the rule holds under any race. In Postgres when
 * DATABASE_URL is set, in memory otherwise (local development and tests).
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { database, type Db } from "./db.ts";

/** A public key in JWK form: P-256, the only kind the phone makes. */
export type PublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };

export interface Device {
	id: string;
	customerId: string;
	name: string;
	status: "waiting" | "active";
	/** Shown on the phone and on the website while the device waits, so the customer can see both are the same device. */
	code: string;
	/** Verifies the app's requests. Needs no fingerprint, so the app can read what is waiting. */
	authKey: PublicJwk;
	/** Verifies approvals. The phone unlocks it with the fingerprint every time. */
	approvalKey: PublicJwk;
	createdAt: string;
	lastSeenAt?: string;
}

export interface NewDevice {
	name: string;
	authKey: PublicJwk;
	approvalKey: PublicJwk;
}

export interface Approval {
	operationId: string;
	revision: number;
	deviceId: string;
	customerId: string;
	decision: "approved" | "declined";
	/** What the phone's approval signature covered, for the record. Empty when declining, which needs no signature. */
	termsHash: string;
	signature: string;
}

export const ENROLLMENT_MS = 5 * 60_000;
export const CONFIRM_MS = 5 * 60_000;

export type Claimed = { ok: true; device: Device } | { ok: false; reason: "unknown" | "used" | "expired" | "has_device" };

export interface Devices {
	/** Opens an enrollment for a customer: the secret is shown once (in the QR code). Refused while the customer has a live device. */
	startEnrollment(customerId: string): Promise<{ ok: true; id: string; secret: string; expiresAt: number } | { ok: false; reason: "has_device" }>;
	/** The app presents the secret and its keys. Once: the enrollment is spent whatever happens next. */
	claimEnrollment(id: string, secret: string, device: NewDevice): Promise<Claimed>;
	/** The customer's device that is waiting for them to confirm its code, or active. */
	liveOf(customerId: string): Promise<Device | undefined>;
	hasActive(customerId: string): Promise<boolean>;
	/** The customer confirms the waiting device. False when there is none, it is not this one, or it waited too long. */
	confirm(customerId: string, deviceId: string): Promise<boolean>;
	/** Removes a waiting or active device. False when the customer has no such device. */
	remove(customerId: string, deviceId: string): Promise<boolean>;
	/** Every live device, for staff. */
	all(): Promise<Device[]>;
	/** An active device by id, for checking its requests. */
	active(deviceId: string): Promise<Device | undefined>;
	touch(deviceId: string): Promise<void>;
	/** True the first time a nonce is seen for a device, false after: a signed request or approval works once. */
	claimNonce(deviceId: string, nonce: string, ttlMs: number): Promise<boolean>;
	record(approval: Approval): Promise<void>;
	approvals(customerId: string): Promise<(Approval & { decidedAt: string })[]>;
}

const hash = (secret: string): Buffer => createHash("sha256").update(secret).digest();
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// --- in memory ---

export function memoryDevices(now: () => number = Date.now): Devices {
	const enrollments = new Map<string, { customerId: string; secretHash: Buffer; expiresAt: number; used: boolean }>();
	const devices = new Map<string, Device & { waitsUntil: number }>();
	const nonces = new Map<string, number>();
	const log: (Approval & { decidedAt: string })[] = [];
	const liveOf = (customerId: string) => [...devices.values()].find((d) => d.customerId === customerId && (d.status === "active" || d.waitsUntil > now()));
	const strip = ({ waitsUntil: _w, ...device }: Device & { waitsUntil: number }): Device => device;

	return {
		async startEnrollment(customerId) {
			if (liveOf(customerId)) return { ok: false, reason: "has_device" };
			const id = newId("enr"), secret = randomBytes(24).toString("base64url"), expiresAt = now() + ENROLLMENT_MS;
			enrollments.set(id, { customerId, secretHash: hash(secret), expiresAt, used: false });
			return { ok: true, id, secret, expiresAt };
		},
		async claimEnrollment(id, secret, device) {
			const enrollment = enrollments.get(id);
			if (!enrollment || !timingSafeEqual(enrollment.secretHash, hash(secret))) return { ok: false, reason: "unknown" };
			if (enrollment.used) return { ok: false, reason: "used" };
			enrollment.used = true;
			if (enrollment.expiresAt <= now()) return { ok: false, reason: "expired" };
			if (liveOf(enrollment.customerId)) return { ok: false, reason: "has_device" };
			const created: Device & { waitsUntil: number } = { id: newId("dev"), customerId: enrollment.customerId, name: device.name, status: "waiting", code: newCode(), authKey: device.authKey, approvalKey: device.approvalKey, createdAt: new Date(now()).toISOString(), waitsUntil: now() + CONFIRM_MS };
			devices.set(created.id, created);
			return { ok: true, device: strip(created) };
		},
		async liveOf(customerId) {
			const device = liveOf(customerId);
			return device && strip(device);
		},
		async hasActive(customerId) {
			return liveOf(customerId)?.status === "active";
		},
		async confirm(customerId, deviceId) {
			const device = devices.get(deviceId);
			if (!device || device.customerId !== customerId || device.status !== "waiting" || device.waitsUntil <= now()) return false;
			device.status = "active";
			return true;
		},
		async remove(customerId, deviceId) {
			const device = devices.get(deviceId);
			if (!device || device.customerId !== customerId) return false;
			return devices.delete(deviceId);
		},
		async all() {
			return [...devices.values()].filter((d) => d.status === "active" || d.waitsUntil > now()).map(strip);
		},
		async active(deviceId) {
			const device = devices.get(deviceId);
			return device?.status === "active" ? strip(device) : undefined;
		},
		async touch(deviceId) {
			const device = devices.get(deviceId);
			if (device) device.lastSeenAt = new Date(now()).toISOString();
		},
		async claimNonce(deviceId, nonce, ttlMs) {
			for (const [key, until] of nonces) if (until <= now()) nonces.delete(key);
			const key = `${deviceId}:${nonce}`;
			if (nonces.has(key)) return false;
			nonces.set(key, now() + ttlMs);
			return true;
		},
		async record(approval) {
			log.push({ ...approval, decidedAt: new Date(now()).toISOString() });
		},
		async approvals(customerId) {
			return log.filter((a) => a.customerId === customerId).reverse();
		},
	};
}

// --- in Postgres ---

export function postgresDevices(db: Db): Devices {
	let ready: Promise<unknown> | undefined;
	async function create() {
		await db.query(`create table if not exists nova_device_enrollments (id text primary key, customer_id text not null, secret_hash text not null, expires_at timestamptz not null, used boolean not null default false)`);
		await db.query(
			`create table if not exists nova_devices (id text primary key, customer_id text not null, name text not null, status text not null check (status in ('waiting', 'active')), code text not null,
			 auth_key jsonb not null, approval_key jsonb not null, created_at timestamptz not null default now(), waits_until timestamptz not null, last_seen_at timestamptz)`,
		);
		// A customer has one live device: a waiting one that has not timed out, or an active one. A waiting device that timed out is cleared before a new one is added.
		await db.query(`create unique index if not exists nova_devices_one_per_customer on nova_devices (customer_id)`);
		await db.query(`create table if not exists nova_device_nonces (device_id text not null, nonce text not null, expires_at timestamptz not null, primary key (device_id, nonce))`);
		await db.query(
			`create table if not exists nova_approvals (id bigserial primary key, operation_id text not null, revision integer not null, device_id text not null, customer_id text not null, decision text not null,
			 terms_hash text not null, signature text not null, decided_at timestamptz not null default now())`,
		);
		await db.query(`create index if not exists nova_approvals_customer on nova_approvals (customer_id, decided_at desc)`);
	}
	const schema = () => (ready ??= create().catch((error) => { ready = undefined; throw error; }));
	const iso = (v: unknown) => new Date(v as string | Date).toISOString();
	const deviceOf = (r: Record<string, unknown>): Device => ({
		id: String(r.id),
		customerId: String(r.customer_id),
		name: String(r.name),
		status: r.status === "active" ? "active" : "waiting",
		code: String(r.code),
		authKey: r.auth_key as PublicJwk,
		approvalKey: r.approval_key as PublicJwk,
		createdAt: iso(r.created_at),
		...(r.last_seen_at ? { lastSeenAt: iso(r.last_seen_at) } : {}),
	});
	/** Clears a customer's waiting device that timed out, so it no longer holds the one place. */
	const clearStale = (q: Pick<Db, "query">, customerId: string) => q.query(`delete from nova_devices where customer_id = $1 and status = 'waiting' and waits_until <= now()`, [customerId]);

	return {
		async startEnrollment(customerId) {
			await schema();
			await clearStale(db, customerId);
			if ((await db.query(`select 1 from nova_devices where customer_id = $1`, [customerId])).rows.length > 0) return { ok: false, reason: "has_device" };
			const id = newId("enr"), secret = randomBytes(24).toString("base64url"), expiresAt = Date.now() + ENROLLMENT_MS;
			await db.query(`insert into nova_device_enrollments (id, customer_id, secret_hash, expires_at) values ($1, $2, $3, $4)`, [id, customerId, hash(secret).toString("hex"), new Date(expiresAt)]);
			return { ok: true, id, secret, expiresAt };
		},
		async claimEnrollment(id, secret, device) {
			await schema();
			return db.transaction(async (tx): Promise<Claimed> => {
				// Taking the row is what makes it single use: a second claim, even at the same moment, finds it used.
				const row = (await tx.query(`update nova_device_enrollments set used = true where id = $1 and used = false returning customer_id, secret_hash, expires_at`, [id])).rows[0];
				if (!row) {
					const exists = (await tx.query(`select 1 from nova_device_enrollments where id = $1`, [id])).rows.length > 0;
					return { ok: false, reason: exists ? "used" : "unknown" };
				}
				if (!timingSafeEqual(Buffer.from(String(row.secret_hash), "hex"), hash(secret))) throw new WrongSecret();
				if (new Date(row.expires_at as string).getTime() <= Date.now()) return { ok: false, reason: "expired" };
				const customerId = String(row.customer_id);
				await clearStale(tx, customerId);
				const created = (
					await tx.query(
						`insert into nova_devices (id, customer_id, name, status, code, auth_key, approval_key, waits_until) values ($1, $2, $3, 'waiting', $4, $5, $6, $7)
						 on conflict (customer_id) do nothing returning *`,
						[newId("dev"), customerId, device.name, newCode(), JSON.stringify(device.authKey), JSON.stringify(device.approvalKey), new Date(Date.now() + CONFIRM_MS)],
					)
				).rows[0];
				return created ? { ok: true, device: deviceOf(created) } : { ok: false, reason: "has_device" };
			}).catch((error) => {
				// A wrong secret must not spend the real enrollment: the transaction rolled back, so the row is still open.
				if (error instanceof WrongSecret) return { ok: false, reason: "unknown" } as const;
				throw error;
			});
		},
		async liveOf(customerId) {
			await schema();
			await clearStale(db, customerId);
			const row = (await db.query(`select * from nova_devices where customer_id = $1`, [customerId])).rows[0];
			return row ? deviceOf(row) : undefined;
		},
		async hasActive(customerId) {
			await schema();
			return (await db.query(`select 1 from nova_devices where customer_id = $1 and status = 'active'`, [customerId])).rows.length > 0;
		},
		async confirm(customerId, deviceId) {
			await schema();
			return (await db.query(`update nova_devices set status = 'active' where id = $1 and customer_id = $2 and status = 'waiting' and waits_until > now() returning id`, [deviceId, customerId])).rows.length > 0;
		},
		async remove(customerId, deviceId) {
			await schema();
			return (await db.query(`delete from nova_devices where id = $1 and customer_id = $2 returning id`, [deviceId, customerId])).rows.length > 0;
		},
		async all() {
			await schema();
			return (await db.query(`select * from nova_devices where status = 'active' or waits_until > now() order by created_at`)).rows.map(deviceOf);
		},
		async active(deviceId) {
			await schema();
			const row = (await db.query(`select * from nova_devices where id = $1 and status = 'active'`, [deviceId])).rows[0];
			return row ? deviceOf(row) : undefined;
		},
		async touch(deviceId) {
			await schema();
			await db.query(`update nova_devices set last_seen_at = now() where id = $1`, [deviceId]);
		},
		async claimNonce(deviceId, nonce, ttlMs) {
			await schema();
			await db.query(`delete from nova_device_nonces where expires_at <= now()`);
			return (await db.query(`insert into nova_device_nonces (device_id, nonce, expires_at) values ($1, $2, $3) on conflict do nothing returning nonce`, [deviceId, nonce, new Date(Date.now() + ttlMs)])).rows.length > 0;
		},
		async record(a) {
			await schema();
			await db.query(`insert into nova_approvals (operation_id, revision, device_id, customer_id, decision, terms_hash, signature) values ($1, $2, $3, $4, $5, $6, $7)`, [a.operationId, a.revision, a.deviceId, a.customerId, a.decision, a.termsHash, a.signature]);
		},
		async approvals(customerId) {
			await schema();
			const rows = (await db.query(`select * from nova_approvals where customer_id = $1 order by id desc`, [customerId])).rows;
			return rows.map((r) => ({ operationId: String(r.operation_id), revision: Number(r.revision), deviceId: String(r.device_id), customerId: String(r.customer_id), decision: r.decision === "declined" ? "declined" : "approved", termsHash: String(r.terms_hash), signature: String(r.signature), decidedAt: iso(r.decided_at) }));
		},
	};
}

class WrongSecret extends Error {}

declare global {
	var __proteaDevices: Devices | undefined;
}

/**
 * The devices in use. In production Postgres is required: without it every enrolled phone would be forgotten on a restart, and
 * the bank would let agent payments through that a phone should have approved.
 */
export async function devices(env: Record<string, string | undefined> = process.env): Promise<Devices> {
	if (globalThis.__proteaDevices) return globalThis.__proteaDevices;
	const db = await database(env);
	if (db) return (globalThis.__proteaDevices = postgresDevices(db));
	if (env.NODE_ENV === "production") throw new Error("DATABASE_URL is not set: Protea Bank has nowhere to keep its customers' devices");
	return (globalThis.__proteaDevices = memoryDevices());
}
