import { describe, expect, it } from "vitest";
import { parseCustomerEmails, parseEmails, sessionFor } from "./auth.ts";
import { memoryLinks } from "./links.ts";

const env = { CUSTOMER_EMAILS: "Thandi@Example.com=cus_thandi, pieter@example.com=cus_pieter nobody@example.com=cus_unknown", STAFF_EMAILS: "Sam@Bank.example" };

describe("who a Curity user is", () => {
	it("reads email=customer pairs, ignoring case in the email", () => {
		expect([...parseCustomerEmails(env.CUSTOMER_EMAILS)]).toEqual([["thandi@example.com", "cus_thandi"], ["pieter@example.com", "cus_pieter"], ["nobody@example.com", "cus_unknown"]]);
		expect([...parseCustomerEmails(undefined)]).toEqual([]);
		expect([...parseEmails(" A@b.com, c@D.com ")]).toEqual(["a@b.com", "c@d.com"]);
	});

	it("keeps the customer out of the session: the link table says who a login is", async () => {
		const links = memoryLinks();
		await links.link({ sub: "s1" }, "cus_pieter", "Sam");
		expect(await sessionFor({ sub: "s1", email: "thandi@example.com", name: "Thandi" }, links, {})).toEqual({ sub: "s1", email: "thandi@example.com", name: "Thandi", staff: false });
		expect(await links.customerFor("s1")).toBe("cus_pieter");
	});

	it("notes a login with no link as pending, so staff can link it", async () => {
		const links = memoryLinks();
		expect(await sessionFor({ sub: "s2", email: "stranger@example.com", name: "S" }, links, env)).toEqual({ sub: "s2", email: "stranger@example.com", name: "S", staff: false });
		expect(await links.customerFor("s2")).toBeUndefined();
		expect(await links.pending()).toMatchObject([{ sub: "s2", email: "stranger@example.com" }]);
		await sessionFor({ sub: "s3" }, links, env);
		expect((await links.pending()).map((p) => p.sub)).toEqual(["s3", "s2"]);
	});

	it("imports a login listed in CUSTOMER_EMAILS once, as a link on its sub (temporary)", async () => {
		const links = memoryLinks();
		await sessionFor({ sub: "s4", email: "THANDI@example.com" }, links, env);
		expect(await links.customerFor("s4")).toBe("cus_thandi");
		expect(await links.linked()).toMatchObject([{ sub: "s4", linkedBy: "CUSTOMER_EMAILS" }]);
		expect(await links.pending()).toEqual([]);
		// The variable no longer matters once the link exists, and a later change to it does not move it.
		await sessionFor({ sub: "s4", email: "THANDI@example.com" }, links, { CUSTOMER_EMAILS: "thandi@example.com=cus_pieter" });
		expect(await links.customerFor("s4")).toBe("cus_thandi");
	});

	it("does not import a customer that does not exist", async () => {
		const links = memoryLinks();
		await sessionFor({ sub: "s5", email: "nobody@example.com" }, links, env);
		expect(await links.customerFor("s5")).toBeUndefined();
		expect((await links.pending()).map((p) => p.sub)).toEqual(["s5"]);
	});

	it("makes staff only the people on STAFF_EMAILS, and nobody when it is not set", async () => {
		const links = memoryLinks();
		expect((await sessionFor({ sub: "s6", email: "sam@bank.example" }, links, env)).staff).toBe(true);
		expect((await sessionFor({ sub: "s1", email: "thandi@example.com" }, links, env)).staff).toBe(false);
		expect((await sessionFor({ sub: "s6", email: "sam@bank.example" }, links, {})).staff).toBe(false);
	});

	it("never makes an unverified email staff", async () => {
		const links = memoryLinks();
		expect((await sessionFor({ sub: "x", email: "sam@bank.example", emailVerified: false }, links, env)).staff).toBe(false);
		expect((await sessionFor({ sub: "x", email: "sam@bank.example", emailVerified: true }, links, env)).staff).toBe(true);
	});

	it("makes an unverified email staff only when STAFF_TRUST_UNVERIFIED is 1", async () => {
		const links = memoryLinks();
		const unverified = { sub: "x", email: "sam@bank.example", emailVerified: false };
		expect((await sessionFor(unverified, links, { ...env, STAFF_TRUST_UNVERIFIED: "1" })).staff).toBe(true);
		expect((await sessionFor(unverified, links, { ...env, STAFF_TRUST_UNVERIFIED: "0" })).staff).toBe(false);
		expect((await sessionFor({ ...unverified, email: "thandi@example.com" }, links, { ...env, STAFF_TRUST_UNVERIFIED: "1" })).staff).toBe(false);
	});
});
