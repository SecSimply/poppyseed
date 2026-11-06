import { afterEach, describe, expect, it } from "vitest";
import { siteCustomer } from "./customers.ts";
import { GET, POST } from "../app/test-hooks/[hook]/route.ts";

const ctx = (hook: string) => ({ params: Promise.resolve({ hook }) });
const post = (hook: string) => POST(new Request(`https://bank.example/test-hooks/${hook}`, { method: "POST", body: JSON.stringify({ args: ["alice"] }) }), ctx(hook));

afterEach(() => void delete process.env.POPPYSEED_TEST_HOOKS);

describe("the conformance hooks", () => {
	it("do not exist unless the test flag is on, so a production site never signs anyone in this way", async () => {
		delete process.env.POPPYSEED_TEST_HOOKS;
		expect((await GET(new Request("https://bank.example/test-hooks/hooks"), ctx("hooks"))).status).toBe(404);
		expect((await post("siteSignIn")).status).toBe(404);
		expect((await post("endSession")).status).toBe(404);
	});

	it("are off for any value but 1", async () => {
		process.env.POPPYSEED_TEST_HOOKS = "true";
		expect((await post("siteSignIn")).status).toBe(404);
	});

	it("sign in the two demo customers when on, and refuse a hook that is not listed", async () => {
		process.env.POPPYSEED_TEST_HOOKS = "1";
		const { result } = (await (await post("siteSignIn")).json()) as { result: string };
		expect(siteCustomer(result)?.id).toBe("cus_thandi");
		expect((await post("constructor")).status).toBe(404);
		const listed = (await (await GET(new Request("https://bank.example/test-hooks/hooks"), ctx("hooks"))).json()) as { hooks: string[]; profile: { publicTool: { name: string } } };
		expect(listed.hooks).toContain("staffJoin");
		expect(listed.profile.publicTool.name).toBe("get_rates");
	});
});
