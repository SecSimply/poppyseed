import type { Operation, OperationReply } from "poppyseed/agent";
import type { ProtocolEvent } from "../shared/events.ts";

/** The parts of the agent this needs, so it can be tested with a stand-in. */
export interface OperationAgent {
	confirm(token: string, operation: Pick<Operation, "operation_id" | "revision">, approvedBy?: string): Promise<OperationReply>;
	cancel(token: string, operationId: string): Promise<Operation>;
	operation(token: string, operationId: string): Promise<OperationReply>;
}

export interface ApprovalOptions {
	emit: (event: ProtocolEvent) => void;
	/** Resolves when the person decides in the inspector. */
	decide: () => Promise<"approve" | "decline">;
	/** The person has told this agent it may confirm operations without asking, as long as the company doesn't require their own approval. */
	standingPermission: boolean;
	sleep: (ms: number) => Promise<void>;
}

const FINAL: Operation["state"][] = ["succeeded", "failed", "cancelled", "expired"];

/**
 * Gets an operation approved and confirmed (operations extension 5). The agent never confirms before an approval it
 * may rely on:
 * - an operation that needs the person's own approval always goes to the person, and is confirmed as theirs;
 * - any other goes to the person too, unless a standing permission covers it, and is then confirmed as that.
 * A decline cancels the operation. Nothing here treats text from the company as an approval.
 */
export async function approveOperation(agent: OperationAgent, token: string, op: Operation, { emit, decide, standingPermission, sleep }: ApprovalOptions): Promise<{ operation: Operation; summary: string[] }> {
	const own = op.user_approval_required === true;
	const standing = standingPermission && !own;
	let approvedBy = "standing_permission";
	if (!standing) {
		emit({
			type: "action.required",
			step: "approve",
			kind: "approve-operation",
			title: own ? "Approve this yourself" : "Approve or decline this operation",
			lines: [
				op.summary,
				...(own ? ["The company requires your own approval for this one. A standing permission would be refused."] : []),
				`terms: ${JSON.stringify(op.terms ?? {})}`,
				...(op.expires_at ? [`expires: ${op.expires_at}`] : []),
			],
			at: Date.now(),
		});
		if ((await decide()) === "decline") {
			const operation = await agent.cancel(token, op.operation_id);
			emit({ type: "action.resolved", step: "approve", outcome: "declined", at: Date.now() });
			return { operation, summary: ["declined: the operation was cancelled", `state: ${operation.state}`] };
		}
		approvedBy = "user";
	}
	let reply = await agent.confirm(token, op, approvedBy);
	for (let i = 0; i < 10 && !FINAL.includes(reply.operation.state); i++) {
		await sleep(Math.max(1000, Number(reply.retryAfter) * 1000 || 1000));
		reply = await agent.operation(token, op.operation_id);
	}
	const operation = reply.operation;
	emit({ type: "action.resolved", step: "approve", outcome: standing ? "standing permission" : "approved", at: Date.now() });
	return {
		operation,
		summary: [
			...(standing ? ["within your standing permission: confirmed without asking"] : []),
			`state: ${operation.state}`,
			operation.result?.summary ?? "",
			`approved_by: ${operation.confirmation?.approved_by ?? approvedBy}`,
		].filter(Boolean),
	};
}
