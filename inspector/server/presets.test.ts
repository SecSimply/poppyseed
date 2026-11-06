import { describe, expect, it } from "vitest";
import { parseOperations } from "./presets.ts";

describe("parseOperations", () => {
	it("defaults to one small Protea Bank payment when nothing is set", () => {
		const [only, ...rest] = parseOperations({});
		expect(rest).toEqual([]);
		expect(only).toMatchObject({ label: "Pay Boland Power R10,00", name: "pay_payee", arguments: { amount: "10.00" } });
	});

	it("uses OPERATION_TOOL and OPERATION_ARGS for a single operation", () => {
		expect(parseOperations({ OPERATION_TOOL: "pay_payee", OPERATION_ARGS: '{"amount":"5.00"}' })).toEqual([{ label: "pay_payee", name: "pay_payee", arguments: { amount: "5.00" } }]);
	});

	it("reads a list of operations to choose between, in order", () => {
		const list = [{ label: "Small", tool: "pay_payee", arguments: { amount: "9.00" } }, { label: "Large", tool: "pay_payee" }];
		expect(parseOperations({ OPERATIONS: JSON.stringify(list) }).map((o) => [o.label, o.name, o.arguments])).toEqual([["Small", "pay_payee", { amount: "9.00" }], ["Large", "pay_payee", undefined]]);
	});

	it.each([
		["not a list", '{"label":"x"}'],
		["an empty list", "[]"],
		["an entry without a label", '[{"tool":"t"}]'],
		["an entry without a tool", '[{"label":"x"}]'],
		["arguments that are not an object", '[{"label":"x","tool":"t","arguments":[1]}]'],
		["too many entries", JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ label: `o${i}`, tool: "t" })))],
	])("refuses %s, at startup, so a typo does not become a silent default", (_name, OPERATIONS) => {
		expect(() => parseOperations({ OPERATIONS })).toThrow();
	});

	it("refuses OPERATION_ARGS that is not an object", () => {
		expect(() => parseOperations({ OPERATION_ARGS: "[1]" })).toThrow(/object/);
	});
});
