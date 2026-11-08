/** What MCP clients are told about each tool's effects: no request can tell a declared hint from a default one. */
import { expect, it } from "vitest";
import { z } from "zod";
import { Tools } from "../src/tools.ts";
import type { ToolDefinition } from "../src/types.ts";

const input = z.object({});
const tools = new Tools(
	new Map<string, ToolDefinition>([
		["looks", { description: "reads", scope: null, input, run: () => "ok", readOnly: true }],
		["unsure", { description: "undeclared", scope: null, input, run: () => "ok" }],
		["acts", { description: "acts", scope: null, input, operation: { propose: () => ({ summary: "s", terms: {} }), perform: () => ({ summary: "done", terms: {} }) } as never }],
	]),
	undefined as never,
	undefined as never,
);
const hints = (name: string) => tools.list.find((t) => t.name === name)?.annotations;

it("marks only tools that declare themselves read-only, and never an operation", () => {
	expect(hints("looks")).toEqual({ readOnlyHint: true, destructiveHint: false });
	expect(hints("unsure")).toEqual({ readOnlyHint: false, destructiveHint: true });
	expect(hints("acts")).toEqual({ readOnlyHint: false, destructiveHint: true });
});
