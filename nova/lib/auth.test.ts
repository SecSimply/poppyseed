import { describe, expect, it } from "vitest";
import { parseCustomerEmails, parseEmails, sessionFor } from "./auth.ts";

const env = { CUSTOMER_EMAILS: "Thandi@Example.com=cus_thandi, pieter@example.com=cus_pieter nobody@example.com=cus_unknown", STAFF_EMAILS: "Sam@Bank.example" };

describe("who a Curity user is", () => {
	it("reads email=customer pairs, ignoring case in the email", () => {
		expect([...parseCustomerEmails(env.CUSTOMER_EMAILS)]).toEqual([["thandi@example.com", "cus_thandi"], ["pieter@example.com", "cus_pieter"], ["nobody@example.com", "cus_unknown"]]);
		expect([...parseCustomerEmails(undefined)]).toEqual([]);
		expect([...parseEmails(" A@b.com, c@D.com ")]).toEqual(["a@b.com", "c@d.com"]);
	});

	it("makes a mapped user their customer, by email in any case", () => {
		expect(sessionFor({ sub: "s1", email: "THANDI@example.com", name: "Thandi" }, env)).toEqual({ sub: "s1", email: "THANDI@example.com", name: "Thandi", customerId: "cus_thandi", staff: false });
	});

	it("signs an unmapped user in with no customer, so no accounts", () => {
		expect(sessionFor({ sub: "s2", email: "stranger@example.com" }, env)).toEqual({ sub: "s2", email: "stranger@example.com", staff: false });
		expect(sessionFor({ sub: "s3" }, env)).toEqual({ sub: "s3", staff: false });
	});

	it("does not link a customer that does not exist", () => {
		expect(sessionFor({ sub: "s4", email: "nobody@example.com" }, env).customerId).toBeUndefined();
	});

	it("makes staff only the people on STAFF_EMAILS, and nobody when it is not set", () => {
		expect(sessionFor({ sub: "s5", email: "sam@bank.example" }, env).staff).toBe(true);
		expect(sessionFor({ sub: "s1", email: "thandi@example.com" }, env).staff).toBe(false);
		expect(sessionFor({ sub: "s5", email: "sam@bank.example" }, {}).staff).toBe(false);
	});

	it("does not take an email the provider says is unverified for a customer or for staff", () => {
		expect(sessionFor({ sub: "x", email: "thandi@example.com", emailVerified: false }, env)).toEqual({ sub: "x", email: "thandi@example.com", staff: false });
		expect(sessionFor({ sub: "x", email: "sam@bank.example", emailVerified: false }, env).staff).toBe(false);
		expect(sessionFor({ sub: "x", email: "sam@bank.example", emailVerified: true }, env).staff).toBe(true);
	});
});
