import { expect, it } from "vitest";
import { approvalHeaders } from "./approval-headers.ts";

it("refuses to be framed and is never cached on the approval page and the account page", () => {
	expect(approvalHeaders.map((r) => r.source)).toEqual(["/payments/approve/:id", "/account"]);
	for (const rule of approvalHeaders) {
		const header = (key: string) => rule.headers.find((h) => h.key === key)?.value;
		expect(header("Content-Security-Policy"), rule.source).toContain("frame-ancestors 'none'");
		expect(header("Cache-Control"), rule.source).toBe("no-store");
	}
});
