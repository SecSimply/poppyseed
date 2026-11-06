import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { secret as defaultSecret, secure } from "./env.ts";

/** Who is signed in to Protea Bank's own website in a browser. Kept in a sealed cookie; no provider token is kept. */
export interface Session {
	/** The identity provider's id for the person. */
	sub: string;
	email?: string;
	name?: string;
	/** The customer record this person is, when the provider's email maps to one. A signed-in person with none sees no accounts. */
	customerId?: string;
	/** Curity said this login's email is not verified, so it was not used to find a customer or staff. Kept so the page can say why. */
	emailUnverified?: true;
	/** May use the support console. Set by STAFF_EMAILS, which a person at the bank edits by hand. */
	staff: boolean;
}

/** The login in progress: which browser started it, as whom, and where to go afterwards. */
export interface LoginInProgress {
	state: string;
	as: "customer" | "staff";
	returnTo: string;
}

export const SESSION_COOKIE = secure ? "__Host-pb_session" : "pb_session";
export const LOGIN_COOKIE = secure ? "__Host-pb_login" : "pb_login";
export const SESSION_HOURS = { customer: 8, staff: 4 } as const;
export const LOGIN_SECONDS = 600;

type Purpose = "session" | "login";
interface Options {
	secret?: string;
	/** Seconds since the epoch. For tests. */
	now?: number;
}

const keyFor = (purpose: Purpose, secret: string) => Buffer.from(hkdfSync("sha256", secret, "protea-bank", `cookie:${purpose}`, 32));

/** AES-256-GCM, with the purpose as associated data and as a key input, so a login cookie never opens as a session. */
function seal(purpose: Purpose, data: object, ttlSec: number, { secret = defaultSecret, now = Math.floor(Date.now() / 1000) }: Options): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", keyFor(purpose, secret), iv);
	cipher.setAAD(Buffer.from(purpose));
	const body = Buffer.concat([cipher.update(JSON.stringify({ ...data, exp: now + ttlSec }), "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function open(purpose: Purpose, token: string | undefined, { secret = defaultSecret, now = Math.floor(Date.now() / 1000) }: Options): Record<string, unknown> | undefined {
	if (!token) return undefined;
	try {
		const raw = Buffer.from(token, "base64url");
		if (raw.length < 12 + 16 + 2) return undefined;
		const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose, secret), raw.subarray(0, 12));
		decipher.setAAD(Buffer.from(purpose));
		decipher.setAuthTag(raw.subarray(12, 28));
		const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Record<string, unknown>;
		return typeof data.exp === "number" && data.exp > now ? data : undefined;
	} catch {
		return undefined; // not ours, tampered with, or from another secret: the same as no cookie
	}
}

export const sealSession = (session: Session, options: Options = {}): string => seal("session", session, SESSION_HOURS[session.staff ? "staff" : "customer"] * 3600, options);
export const sealLogin = (login: LoginInProgress, options: Options = {}): string => seal("login", login, LOGIN_SECONDS, options);

export function openSession(token: string | undefined, options: Options = {}): Session | undefined {
	const d = open("session", token, options);
	if (!d || typeof d.sub !== "string") return undefined;
	return { sub: d.sub, ...(typeof d.email === "string" ? { email: d.email } : {}), ...(typeof d.name === "string" ? { name: d.name } : {}), ...(typeof d.customerId === "string" ? { customerId: d.customerId } : {}), ...(d.emailUnverified === true ? { emailUnverified: true as const } : {}), staff: d.staff === true };
}

export function openLogin(token: string | undefined, options: Options = {}): LoginInProgress | undefined {
	const d = open("login", token, options);
	if (!d || typeof d.state !== "string" || typeof d.returnTo !== "string" || (d.as !== "customer" && d.as !== "staff")) return undefined;
	return { state: d.state, as: d.as, returnTo: d.returnTo };
}

/** One cookie's value from a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string | undefined {
	for (const part of (header ?? "").split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) return v.join("=");
	}
	return undefined;
}

/** The session in a request's Cookie header, if there is a valid one. */
export const sessionFrom = (cookieHeader: string | null | undefined, options: Options = {}): Session | undefined => openSession(cookieValue(cookieHeader, SESSION_COOKIE), options);

const flags = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
export const setCookie = (name: string, value: string, maxAgeSec: number): string => `${name}=${value}; ${flags}; Max-Age=${maxAgeSec}`;
export const clearCookie = (name: string): string => `${name}=; ${flags}; Max-Age=0`;
export const sessionCookie = (session: Session, options: Options = {}): string => setCookie(SESSION_COOKIE, sealSession(session, options), SESSION_HOURS[session.staff ? "staff" : "customer"] * 3600);
