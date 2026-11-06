import { describe, expect, it } from "vitest";
import { cookieValue, openLogin, openSession, sealLogin, sealSession, SESSION_COOKIE, sessionFrom, type Session } from "./session.ts";

const secret = "test-secret-test-secret-test-secret-0123";
const NOW = 1_800_000_000;
const thandi: Session = { sub: "s1", email: "thandi@proteabank.example", name: "Thandi Nkosi", customerId: "cus_thandi", staff: false };

describe("session cookie", () => {
	it("opens what was sealed, and nothing is readable in it", () => {
		const token = sealSession(thandi, { secret, now: NOW });
		expect(openSession(token, { secret, now: NOW + 60 })).toEqual(thandi);
		expect(token).not.toContain("thandi");
		expect(Buffer.from(token, "base64url").toString("utf8")).not.toContain("thandi");
	});

	it("expires: 8 hours for a customer, 4 for staff", () => {
		const customer = sealSession(thandi, { secret, now: NOW });
		expect(openSession(customer, { secret, now: NOW + 8 * 3600 - 1 })).toBeDefined();
		expect(openSession(customer, { secret, now: NOW + 8 * 3600 })).toBeUndefined();
		const staff = sealSession({ ...thandi, staff: true }, { secret, now: NOW });
		expect(openSession(staff, { secret, now: NOW + 4 * 3600 - 1 })?.staff).toBe(true);
		expect(openSession(staff, { secret, now: NOW + 4 * 3600 })).toBeUndefined();
	});

	it("refuses another secret, a changed byte, truncation, and garbage", () => {
		const token = sealSession(thandi, { secret, now: NOW });
		expect(openSession(token, { secret: "another-secret-another-secret-0123456789", now: NOW })).toBeUndefined();
		const raw = Buffer.from(token, "base64url");
		raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
		expect(openSession(raw.toString("base64url"), { secret, now: NOW })).toBeUndefined();
		expect(openSession(token.slice(0, 20), { secret, now: NOW })).toBeUndefined();
		for (const junk of [undefined, "", "cus_thandi", "not base64 !!"]) expect(openSession(junk, { secret, now: NOW })).toBeUndefined();
	});

	it("never takes a login cookie for a session, or the other way round", () => {
		const login = sealLogin({ state: "abc", as: "staff", returnTo: "/staff" }, { secret, now: NOW });
		expect(openSession(login, { secret, now: NOW })).toBeUndefined();
		expect(openLogin(sealSession(thandi, { secret, now: NOW }), { secret, now: NOW })).toBeUndefined();
	});

	it("keeps staff false unless it was sealed true", () => {
		expect(openSession(sealSession({ sub: "s", staff: false }, { secret, now: NOW }), { secret, now: NOW })?.staff).toBe(false);
	});
});

describe("login in progress", () => {
	it("round-trips for ten minutes", () => {
		const token = sealLogin({ state: "abc", as: "customer", returnTo: "/account" }, { secret, now: NOW });
		expect(openLogin(token, { secret, now: NOW + 599 })).toEqual({ state: "abc", as: "customer", returnTo: "/account" });
		expect(openLogin(token, { secret, now: NOW + 600 })).toBeUndefined();
	});
});

describe("cookies", () => {
	it("finds one cookie among several, and does not mistake a longer name for it", () => {
		expect(cookieValue(`a=1; ${SESSION_COOKIE}=xyz==; b=2`, SESSION_COOKIE)).toBe("xyz==");
		expect(cookieValue(`x${SESSION_COOKIE}=nope`, SESSION_COOKIE)).toBeUndefined();
		expect(cookieValue(null, SESSION_COOKIE)).toBeUndefined();
	});
	it("reads the session from a Cookie header", () => {
		expect(sessionFrom(`${SESSION_COOKIE}=${sealSession(thandi)}`)?.customerId).toBe("cus_thandi");
		expect(sessionFrom("other=1")).toBeUndefined();
	});
});
