import { describe, expect, it } from "vitest";
import { EXCLUDED_PHRASES, excludedTaskOf, excludedTasks } from "./excluded.ts";

describe("excluded tasks", () => {
	it("serves a task, with an alternative, for each", () => {
		const list = excludedTasks("https://protea.example");
		expect(list.map((t) => t.task)).toEqual(EXCLUDED_PHRASES);
		for (const t of list) {
			expect(t.task.length).toBeLessThanOrEqual(200);
			expect(t.alternative?.instructions?.length).toBeGreaterThan(0);
			expect(t.alternative!.instructions!.length).toBeLessThanOrEqual(2000);
		}
		expect(list[0]!.alternative?.references).toEqual([{ web: "https://protea.example/payees" }]);
		expect(excludedTasks("http://localhost:3000")[0]!.alternative?.references).toBeUndefined();
	});

	it("recognises each task in the words a customer would use", () => {
		const asks: [string, string][] = [
			["Add a new payee", "Add a new payee"],
			["can you set up a beneficiary for my landlord", "Add a new payee"],
			["save a new recipient", "Add a new payee"],
			["Close my savings account please", "Close an account"],
			["I want to close the account", "Close an account"],
			["send an international payment to London", "Send an international payment"],
			["wire money overseas", "Send an international payment"],
			["SWIFT transfer", "Send an international payment"],
		];
		for (const [text, task] of asks) expect(excludedTaskOf(text)?.task, text).toBe(task);
	});

	it("leaves what the bank does offer alone", () => {
		for (const text of ["pay my payee Boland Power", "what are my balances", "list my payees", "transfer R200 to savings", "find a branch", "my account"]) expect(excludedTaskOf(text), text).toBeUndefined();
	});

	it("names every phrase in its own pattern, so the chat and the document agree", () => {
		for (const phrase of EXCLUDED_PHRASES) expect(excludedTaskOf(phrase)?.task, phrase).toBe(phrase);
	});
});
