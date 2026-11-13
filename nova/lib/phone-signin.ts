/**
 * Sign in with your phone: the bank's side of registering a phone with the device auth service. That service is separate
 * (its own address and database). A phone can register there only with a one-time code, and this website creates the
 * code for a customer who is signed in, in their own browser. The service then knows the phone as that customer's. The
 * admin key that creates codes stays on the server: nothing here is imported by a page that runs in the browser.
 */
import { z } from "zod";
import { qr, type Qr } from "./qr.ts";

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

export type Started = { ok: true; id: string; expiresAt: number; qr: Qr; link: string } | { ok: false; reason: "limit" };
export type CodeState = { state: "pending" | "used" | "expired"; deviceId?: string };

export interface PhoneSignin {
	/** The customer's phones that can still sign in. */
	phones(owner: string): Promise<Phone[]>;
	/** A one-time code for this customer, as the QR code and link a phone scans. */
	start(owner: string): Promise<Started>;
	/** What happened to a code, if it is this customer's. A code made for someone else is nothing to them. */
	codeOf(owner: string, enrolmentId: string): Promise<CodeState | undefined>;
	/** Removes the customer's phone. False when there is no such phone of theirs. */
	remove(owner: string, deviceId: string): Promise<boolean>;
}

/** What an id from the browser may look like (a code's id, a phone's id): letters, digits, "_" and "-". Anything else is not an id and is never put into a path, where "." and ".." would change which address the admin key is sent to. */
const ID = /^[A-Za-z0-9_-]{1,80}$/;

const when = z.string().refine((s) => !Number.isNaN(Date.parse(s)));
const created = z.object({ enrolmentId: z.string(), code: z.string(), expiresAt: when });
const status = z.object({ state: z.enum(["pending", "used", "expired"]), owner: z.string(), expiresAt: when, deviceId: z.string().nullable() });
const list = z.object({ devices: z.array(z.object({ deviceId: z.string(), label: z.string().nullable(), status: z.enum(["active", "revoked"]), createdAt: when, lastAuthAt: when.nullable() })) });

export function phoneSignin(config: PhoneSigninConfig | undefined = phoneSigninConfig(), fetchImpl: typeof fetch = fetch): PhoneSignin | undefined {
	if (!config) return undefined;

	async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
		try {
			return await fetchImpl(`${config!.url}${path}`, {
				method,
				headers: { "x-admin-key": config!.adminKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
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

	return {
		phones,
		async start(owner) {
			if ((await phones(owner)).length >= MAX_PHONES) return { ok: false, reason: "limit" };
			const res = await call("POST", "/v1/admin/enrolments", { owner, minutes: CODE_MINUTES });
			if (res.status !== 201) throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
			const made = await read(res, created);
			const link = `protea-device://enroll?${new URLSearchParams({ o: config.publicUrl, c: made.code })}`;
			return { ok: true, id: made.enrolmentId, expiresAt: Date.parse(made.expiresAt), qr: qr(link), link };
		},
		async codeOf(owner, enrolmentId) {
			if (!ID.test(enrolmentId)) return undefined;
			const res = await call("GET", `/v1/admin/enrolments/${encodeURIComponent(enrolmentId)}`);
			if (res.status === 404) return undefined;
			if (!res.ok) throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
			const s = await read(res, status);
			if (s.owner !== owner) return undefined;
			return { state: s.state, ...(s.deviceId ? { deviceId: s.deviceId } : {}) };
		},
		async remove(owner, deviceId) {
			if (!ID.test(deviceId)) return false;
			const res = await call("POST", `/v1/admin/owners/${encodeURIComponent(owner)}/devices/${encodeURIComponent(deviceId)}/revoke`);
			if (res.status === 204) return true;
			if (res.status === 404) return false;
			throw new PhoneSigninError(`The sign-in service answered ${res.status}.`);
		},
	};
}
