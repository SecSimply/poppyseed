import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryLinks } from "./links.ts";
import type { Session } from "./session.ts";

// Deployed over https, which is where unlinking must take effect at once.
vi.mock("./env.ts", () => ({ secure: true, baseUrl: "https://bank.example", secret: "test-secret-test-secret-test-secret-123" }));
const { customerOfSession } = await import("./customers.ts");

const login = (sub: string, rest: Partial<Session> = {}): Session => ({ sub, staff: false, ...rest });

describe("customerOfSession, deployed", () => {
	beforeEach(() => {
		globalThis.__proteaLinks = memoryLinks();
	});

	it("is whoever the link table says, asked afresh, so unlinking takes effect at once", async () => {
		await globalThis.__proteaLinks!.link({ sub: "s1" }, "cus_thandi", "Sam");
		expect((await customerOfSession(login("s1")))?.id).toBe("cus_thandi");
		await globalThis.__proteaLinks!.unlink("s1");
		expect(await customerOfSession(login("s1"))).toBeUndefined();
	});

	it("ignores a customer written into an older cookie", async () => {
		expect(await customerOfSession(login("s2", { customerId: "cus_thandi" }))).toBeUndefined();
	});

	it("is nobody without a session", async () => {
		expect(await customerOfSession(undefined)).toBeUndefined();
	});
});
