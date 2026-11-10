/**
 * The phone, end to end through the bank's own Poppy instance: an agent proposes a payment, nothing but the phone can approve it, and
 * the phone's signed approval performs it. The agent, the sign-ins and the operations are the real ones; only the phone is a stand-in.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { check, type Harness, httpAgentHost, runCheck, type AgentHost, type Target } from "poppyseed/conformance";
import { poppyseed } from "../poppyseed.config";
import { approve, decline, list } from "./authenticator.ts";
import { authenticatorDeps } from "./authenticator-deps.ts";
import { bank } from "./bank.ts";
import { hooks, profile } from "./conformance.ts";
import { termsHash } from "./device-auth.ts";
import { devices } from "./devices.ts";
import { baseUrl } from "./env.ts";
import { FakePhone } from "./fake-phone.ts";

let host: AgentHost;
beforeAll(async () => {
	host = await httpAgentHost();
});
afterAll(async () => {
	await host.close?.();
});

const target = (): Target => ({ baseUrl, fetch: async (url, init) => (await poppyseed.handle(new Request(url, init))) ?? new Response("not found", { status: 404 }), agents: host, hooks, profile });

/** Enrolls and confirms a phone for Thandi, as the app and her browser would. */
async function enrollPhone(): Promise<FakePhone> {
	const store = await devices();
	const phone = new FakePhone("Pixel 8");
	const started = await store.startEnrollment("cus_thandi");
	if (!started.ok) throw new Error(started.reason);
	const claimed = await store.claimEnrollment(started.id, started.secret, phone.keys);
	if (!claimed.ok) throw new Error(claimed.reason);
	phone.deviceId = claimed.device.id;
	await store.confirm("cus_thandi", claimed.device.id);
	return phone;
}

it("lets only Thandi's phone approve her agent's payment: not the agent, whatever it claims, and not twice", async () => {
	const phone = await enrollPhone();
	const deps = await authenticatorDeps();
	const balance = async () => {
		const b = await bank();
		return b.balanceCents((await b.accountOf("cus_thandi", "acc_thandi_everyday"))!);
	};
	const before = await balance();
	const result = await runCheck(
		check({
			id: "nova/phone",
			title: "a payment waits for the phone",
			covers: [],
			leg: 3,
			async run(t: Harness) {
				const tool = t.action("action"); // R10,00 to Boland Power: small enough that, without a phone, an agent could confirm it
				const { agent, token } = await t.session({ agent: { extensions: { operations: { version: "1" } } }, signIn: tool.scope });
				const op = await t.propose(agent, token.access_token, tool);
				t.equal(op.user_approval_required, true, "a small payment still needs approval once there is a phone");
				t.ok(/Protea app/.test(op.summary), "the summary tells the agent where the approval is");

				// The agent cannot confirm it, however it describes the approval.
				for (const approvedBy of ["standing_permission", "user"]) {
					await t.refused(`the agent confirms as ${approvedBy}`, agent.confirm(token.access_token, op, approvedBy), { status: 403, error: "user_approval_required" });
				}
				t.equal((await agent.operation(token.access_token, op.operation_id)).operation.state, "proposed", "nothing happened");

				// The phone sees it, and approves with a signature over exactly what it read.
				const waiting = (await (await list(phone.request(baseUrl, "GET", "/authenticator/operations"), deps)).json()) as { operations: { operation_id: string; revision: number; summary: string; terms: Record<string, unknown>; terms_hash: string; agent: { name: string } }[] };
				const shown = waiting.operations.find((o) => o.operation_id === op.operation_id);
				t.ok(shown, "the phone lists the payment");
				t.equal(shown!.terms_hash, termsHash(shown!.summary, shown!.terms), "the hash is the hash of what the phone shows");
				const body = JSON.stringify({ revision: shown!.revision, approval: phone.approve(baseUrl, op.operation_id, shown!.revision, termsHash(shown!.summary, shown!.terms)) });
				const path = `/authenticator/operations/${op.operation_id}/approve`;
				t.equal((await approve(phone.request(baseUrl, "POST", path, body), deps, op.operation_id)).status, 200, "the phone's approval is accepted");
				// The same signed approval, sent again, does nothing more.
				t.equal((await approve(phone.request(baseUrl, "POST", path, body), deps, op.operation_id)).status, 409, "the same approval sent again finds the payment already decided");

				const done = await t.until(async () => {
					const current = (await agent.operation(token.access_token, op.operation_id)).operation;
					return current.state === "succeeded" ? current : undefined;
				}, 10, "the payment did not finish", 0.25);
				t.equal(done.confirmation?.approved_by, "user", "it was approved by the customer");

				// A transfer between her own accounts is the same: the phone, and nothing else.
				const session = await t.session({ agent: { extensions: { operations: { version: "1" } } }, signIn: tool.scope });
				const mcp = await t.mcpToken(session);
				const proposed = await session.agent.mcp<{ structuredContent?: { operation?: { operation_id: string; revision: number; user_approval_required: boolean; summary: string } } }>(mcp.url, mcp.token, "tools/call", {
					name: "transfer_between_accounts",
					arguments: { from_account_id: "acc_thandi_everyday", to_account_id: "acc_thandi_saver", amount: "5.00" },
				});
				const transfer = proposed.structuredContent?.operation;
				t.ok(transfer, "the transfer is proposed");
				t.equal(transfer!.user_approval_required, true, "a small transfer needs approval too");
				t.ok(/Protea app/.test(transfer!.summary), "its summary names the phone");
				await t.refused("the agent confirms the transfer as the customer", session.agent.confirm(session.token.access_token, { operation_id: transfer!.operation_id, revision: transfer!.revision }, "user"), { status: 403, error: "user_approval_required" });
			},
		}),
		target(),
	);
	expect(result.status, result.message).toBe("pass");
	expect(before - (await balance())).toBe(1000);
	expect((await (await devices()).approvals("cus_thandi")).map((a) => a.decision)).toEqual(["approved"]);
});
