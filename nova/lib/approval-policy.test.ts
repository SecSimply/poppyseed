import { expect, it } from "vitest";
import { approvalPolicy } from "./approval-policy.ts";

it("needs the phone for every payment once a customer has one, and the customer only over the limit before that", () => {
	expect(approvalPolicy(false, false, "payment")).toEqual({ userApprovalRequired: false, approvalOnSite: false, note: "" });
	expect(approvalPolicy(true, false, "payment")).toMatchObject({ userApprovalRequired: true, approvalOnSite: false });
	for (const overLimit of [false, true]) {
		expect(approvalPolicy(overLimit, true, "transfer")).toMatchObject({ userApprovalRequired: true, approvalOnSite: true });
	}
});

it("tells the agent what it cannot do: the phone, or the customer themselves, and which kind of operation it is", () => {
	expect(approvalPolicy(false, true, "payment").note).toContain("Protea app on their phone");
	expect(approvalPolicy(true, false, "transfer").note).toContain("This transfer is over the limit");
	expect(approvalPolicy(true, false, "payment").note).toContain("This payment is over the limit");
});
