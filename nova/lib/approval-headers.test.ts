import { expect, it } from "vitest";
import { approvalHeaders } from "./approval-headers.ts";

it("refuses to be framed and is never cached on the approval page", () => {
	const [rule] = approvalHeaders;
	expect(rule?.source).toBe("/payments/approve/:id");
	const header = (key: string) => rule?.headers.find((h) => h.key === key)?.value;
	expect(header("Content-Security-Policy")).toContain("frame-ancestors 'none'");
	expect(header("Cache-Control")).toBe("no-store");
});
