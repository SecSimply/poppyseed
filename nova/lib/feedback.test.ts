import { beforeEach, describe, expect, it } from "vitest";
import { adviceFor, MAX_REPORTS, remember, reports } from "./feedback.ts";

beforeEach(() => void (reports.length = 0));
const report = (task: string, description = "") => ({ kind: "missing", task, description });

describe("feedback", () => {
	it("keeps the newest reports, as text, up to a limit", () => {
		for (let i = 0; i < MAX_REPORTS + 5; i++) remember(report(`task ${i}`, "<script>alert(1)</script>"), "https://a.example/c.json", new Date(0));
		expect(reports).toHaveLength(MAX_REPORTS);
		expect(reports[0]!.task).toBe(`task ${MAX_REPORTS + 4}`);
		expect(reports[0]!.description).toBe("<script>alert(1)</script>");
	});

	it("says how to do a task the bank already offers, and where it does not offer it", () => {
		expect(adviceFor(report("see what I spent last month"))?.references).toEqual([{ tool: "list_transactions" }]);
		expect(adviceFor(report("check my balance"))?.references).toEqual([{ tool: "list_accounts" }]);
		expect(adviceFor(report("add a payee"))?.instructions).toMatch(/own browser/);
	});

	it("says nothing for a task that really is missing", () => {
		expect(adviceFor(report("order a debit card"))).toBeUndefined();
	});
});
