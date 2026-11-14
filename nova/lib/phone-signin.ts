/**
 * The bank's side of registering a phone with the device auth service, so the one phone a customer adds also signs them
 * in. That service is separate (its own address and database). A phone can register there only with a one-time code. The
 * bank hands that code to a phone only after the customer confirmed the phone (the codes matched) and the phone proved
 * itself with a signed request, so a QR code seen by someone else is worth nothing at the service. The admin key that
 * creates codes stays on the server: nothing here is imported by a page that runs in the browser.
 */
import { z } from "zod";

/** How many phones one customer may have. */
export const MAX_PHONES = 3;
/** How long a code works, in minutes. */
const CODE_MINUTES = 10;
const TIMEOUT_MS = 5_000;

export interface PhoneSigninConfig {
	/** Where the server reaches the service (the private address when there is one). */
	url: string;
	adminKey: string;
	/** The address the phone reaches the service at: it goes into the QR code. */
	publicUrl: string;
}

/** Off unless all three settings are given, so a site without the service shows nothing. */
export function phoneSigninConfig(env: Record<string, string | undefined> = process.env): PhoneSigninConfig | undefined {
	const { DEVICE_AUTH_URL: url, DEVICE_AUTH_ADMIN_KEY: adminKey, DEVICE_AUTH_PUBLIC_URL: publicUrl } = env;
	if (!url || !adminKey || !publicUrl) return undefined;
	try {
		new URL(url);
		new URL(publicUrl);
	} catch {
		return undefined;
	}
	return { url: url.replace(/\/+$/, ""), adminKey, publicUrl: publicUrl.replace(/\/+$/, "") };
}

/** The service could not be reached or did not answer as expected. The page says so, and shows nothing the service did not confirm. */
export class PhoneSigninError extends Error {}

export interface Phone {
	id: string;
	label: string | null;
	addedAt: string;
	lastUsedAt: string | null;
}

export type Released = { ok: true; origin: string; code: string; enrolmentId: string; expiresAt: number } | { ok: false; reason: "limit" };
/** Who a session of the service belongs to: the service's device and the customer it was registered for. */
export interface Who {
	deviceId: string;
	owner: string;
}
/** What happened to a code the bank made: whether a phone registered with it, and which device that made. */
export type CodeState = { state: "pending" | "used" | "expired"; owner: string; deviceId?: string };

export interface PhoneSignin {
	/** The customer's phones that can still sign in. */
	phones(owner: string): Promise<Phone[]>;
	/** Whose session this is, or undefined when the service does not accept it (expired, forged, or its device removed). The token is sent to the service only, never the admin key. */
	whoami(token: string): Promise<Who | undefined>;
	/** What became of a code the bank made, or undefined when the service does not know it. */
	enrolmentOf(enrolmentId: string): Promise<CodeState | undefined>;
	/** A one-time code for this customer's confirmed phone, with the service's public address. Refused when the customer already has the most phones registered. */
	release(owner: string): Promise<Released>;
	/** Removes the customer's phone. False when there is no such phone of theirs. */
	remove(owner: string, deviceId: string): Promise<boolean>;
	/** Removes every phone of the customer, when the bank removes the customer's phone. Returns how many. */
	removeAll(owner: string): Promise<number>;
}

/** What an id from the browser may look like (a code's id, a phone's id): letters, digits, "_" and "-". Anything else is not an id and is never put into a path, where "." and ".." would change which address the admin key is sent to. */
const ID = /^[A-Za-z0-9_-]{1,80}$/;

const when = z.string().refine((s) => !Number.isNaN(Date.parse(s)));
const who = z.object({ deviceId: z.string(), owner: z.string() });
const state = z.object({ state: z.enum(["pending", "used", "expired"]), owner: z.string(), expiresAt: when, deviceId: z.string().nullable() });
const created = z.object({ enrolmentId: z.string(), code: z.string(), expiresAt: when });
const list = z.object({ devices: z.array(z.object({ deviceId: z.string(), label: z.string().nullable(), status: z.enum(["active", "revoked"]), createdAt: when, lastAuthAt: when.nullable() })) });

export function phoneSignin(config: PhoneSigninConfig | undefined = phoneSigninConfig(), fetchImpl: typeof fetch = fetch): PhoneSignin | undefined {
	if (!config) return undefined;

	/** A call to the service, with the admin key unless it carries a session token instead. */
	async function call(method: "GET" | "POST", path: string, body?: unknown, bearer?: string): Promise<Response> {
		try {
			return await fetchImpl(`${config!.url}${path}`, {
				method,
				headers: { ...(bearer === undefined ? { "x-admin-key": config!.adminKey } : { authorization: `Bearer ${bearer}` }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				cache: "no-store",
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw new PhoneSigninError("The sign-in service did not answer.");
		}
	}

	async function read<S extends z.ZodType>(res: Response, schema: S): Promise<z.infer<S>> {
		const parsed = schema.safeParse(await res.json().catch(() => undefined));
		if (!parsed.success) throw new PhoneSigninError("The sign-in service answered unexpectedly.");
		return parsed.data;
	}

	const phones = async (owner: string): Promise<Phone[]> => {
		const res = await call("GET", `/v1/admin/owners/${encodeURIComponent(owner)}/devices`);
		if (!res.ok) throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
		return (await read(res, list)).devices.filter((d) => d.status === "active").map((d) => ({ id: d.deviceId, label: d.label, addedAt: d.createdAt, lastUsedAt: d.lastAuthAt }));
	};

	const remove = async (owner: string, deviceId: string): Promise<boolean> => {
		if (!ID.test(deviceId)) return false;
		const res = await call("POST", `/v1/admin/owners/${encodeURIComponent(owner)}/devices/${encodeURIComponent(deviceId)}/revoke`);
		if (res.status === 204) return true;
		if (res.status === 404) return false;
		throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
	};

	return {
		phones,
		async whoami(token) {
			const res = await call("GET", "/v1/whoami", undefined, token);
			if (res.status === 401) return undefined;
			if (!res.ok) throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
			return read(res, who);
		},
		async enrolmentOf(enrolmentId) {
			if (!ID.test(enrolmentId)) return undefined;
			const res = await call("GET", `/v1/admin/enrolments/${encodeURIComponent(enrolmentId)}`);
			if (res.status === 404) return undefined;
			if (!res.ok) throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
			const s = await read(res, state);
			return { state: s.state, owner: s.owner, ...(s.deviceId ? { deviceId: s.deviceId } : {}) };
		},
		async release(owner) {
			if ((await phones(owner)).length >= MAX_PHONES) return { ok: false, reason: "limit" };
			const res = await call("POST", "/v1/admin/enrolments", { owner, minutes: CODE_MINUTES });
			if (res.status !== 201) throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
			const made = await read(res, created);
			return { ok: true, origin: config.publicUrl, code: made.code, enrolmentId: made.enrolmentId, expiresAt: Date.parse(made.expiresAt) };
		},
		remove,
		async removeAll(owner) {
			let removed = 0;
			for (const phone of await phones(owner)) if (await remove(owner, phone.id)) removed++;
			return removed;
		},
	};
}
