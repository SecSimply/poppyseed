import { z } from "zod";
import type { ClientRegistry } from "./clients.ts";
import { PoppyError, ToolError } from "./errors.ts";
import type { Guarded } from "./guard.ts";
import { agentSupportsOperations, OperationFailed, operationJson, type Operations, type OperationView } from "./operations.ts";
import type { ToolDefinition } from "./types.ts";

/** What a tool call came to, the same for MCP, OpenAPI and the Company Agent. */
export type ToolResult =
	| { kind: "output"; output: unknown }
	| { kind: "operation"; operation: OperationView }
	/** The caller lacks a scope. Only conversations report this as a result; APIs answer with a challenge. */
	| { kind: "authorization"; error: "insufficient_scope"; scope: string }
	| { kind: "error"; code: "unknown_tool" | "invalid_input" | "tool_error" | "failed" | "extension_required"; message: string };

export interface ToolInfo {
	name: string;
	description: string;
	scope: string | null;
	inputSchema: unknown;
	proposesOperation: boolean;
	/** MCP tool annotations: read-only only when the tool says so, and an operation tool is never read-only. */
	annotations: { readOnlyHint: boolean; destructiveHint: boolean };
}

/** Your tools, as every channel calls them: scope check, input validation, operations, and errors agents may see. */
export class Tools {
	readonly list: ToolInfo[];
	readonly hasOperations: boolean;
	private byName: ReadonlyMap<string, ToolDefinition>;
	private operations: Operations;
	private clients: ClientRegistry;

	constructor(byName: ReadonlyMap<string, ToolDefinition>, operations: Operations, clients: ClientRegistry) {
		this.byName = byName;
		this.operations = operations;
		this.clients = clients;
		this.list = [...byName].map(([name, tool]) => ({
			name,
			description: tool.description,
			scope: tool.scope,
			inputSchema: z.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input" }),
			proposesOperation: Boolean(tool.operation),
			annotations: tool.operation || !tool.readOnly ? { readOnlyHint: false, destructiveHint: true } : { readOnlyHint: true, destructiveHint: false },
		}));
		this.hasOperations = this.list.some((t) => t.proposesOperation);
	}

	/**
	 * Runs a tool as `auth`. A missing scope throws the protocol challenge;
	 * everything else is a result. Only a ToolError's or OperationFailed's
	 * message reaches the Personal Agent.
	 */
	async run(name: string, input: unknown, auth: Guarded): Promise<ToolResult> {
		const tool = this.byName.get(name);
		if (!tool) return { kind: "error", code: "unknown_tool", message: `unknown tool ${name}` };
		auth.require(tool.scope);
		const parsed = tool.input.safeParse(input ?? {});
		if (!parsed.success) return { kind: "error", code: "invalid_input", message: `Invalid arguments: ${z.prettifyError(parsed.error)}` };
		try {
			if (tool.run) return { kind: "output", output: await tool.run(parsed.data, auth.ctx) };
			if (await agentSupportsOperations(this.clients, auth.ctx.clientId)) {
				return { kind: "operation", operation: operationJson(await this.operations.propose(name, tool, parsed.data, auth.ctx)) };
			}
			// Never an operation for an agent without the extension (extension 2).
			if (tool.operation.withoutExtension !== "perform") return { kind: "error", code: "extension_required", message: "this action needs the operations extension" };
			const proposal = await tool.operation.propose(parsed.data, auth.ctx);
			return { kind: "output", output: await tool.operation.perform({ id: `direct_${crypto.randomUUID()}`, terms: proposal.terms, summary: proposal.summary }, auth.ctx) };
		} catch (error) {
			if (error instanceof PoppyError) throw error;
			if (error instanceof ToolError || error instanceof OperationFailed) return { kind: "error", code: "tool_error", message: error.message };
			console.error(`[poppyseed] tool ${name} failed`, error);
			return { kind: "error", code: "failed", message: "tool failed" };
		}
	}
}
