import type { ClientRegistry } from "./clients.ts";
import { invalidRequest, PoppyError, scopeError } from "./errors.ts";
import type { Guarded } from "./guard.ts";
import { canonical, strictJson } from "./json.ts";
import type { Store } from "./store.ts";
import type { OperationTool, SessionContext, ToolDefinition } from "./types.ts";
import { json, randomId } from "./util.ts";

/**
 * The operations extension, version 1: an action is proposed with its terms,
 * confirmed by the Personal Agent for one revision, and performed at most
 * once (extension sections 3 to 7).
 */

export const OPERATION_STATES = ["proposed", "in_progress", "succeeded", "failed", "cancelled", "expired"] as const;
export type OperationState = (typeof OPERATION_STATES)[number];
const RETAIN_MS = 365 * 86_400_000; // readable for a year; the extension requires it until final

export interface OperationResult {
	/** Every change that was made, in plain language. */
	summary: string;
	data?: Record<string, unknown>;
}

/** Throw from `perform` when the action did not complete. Its message becomes `result.summary`, so say what changed, if anything. */
export class OperationFailed extends Error {
	override name = "OperationFailed";
	readonly data?: Record<string, unknown>;
	constructor(summary: string, data?: Record<string, unknown>) {
		super(summary);
		this.data = data;
	}
}

type Confirmation = { revision: number; approved_by: "user" | "standing_permission"; confirmed_at: string };

/** Each state carries exactly what it has: a proposal its expiry, a confirmed operation its confirmation, a final one its result. */
export type OperationRecord = {
	id: string;
	tool: string;
	key?: string;
	/** Proposed signed in: the account, and the scopes the proposing token had, for the error a signed-out Session gets (extension 3.2). */
	owner: { sessionId: string; clientId: string; userId: string; account: { id: string; scopes: string[] } | null };
	scope: string | null;
	revision: number;
	summary: string;
	terms: Record<string, unknown>;
	userApprovalRequired: boolean;
	url?: string;
} & (
	| { state: "proposed"; expiresAt: number; confirmation: null; result: null }
	| { state: "in_progress"; confirmation: Confirmation; result: null }
	| { state: "succeeded" | "failed"; confirmation: Confirmation; result: OperationResult }
	| { state: "cancelled"; confirmation: Confirmation | null; result: OperationResult }
	| { state: "expired"; confirmation: null; result: OperationResult }
);

/** The operation as the extension shows it (section 3). */
export interface OperationView {
	operation_id: string;
	revision: number;
	state: OperationState;
	summary: string;
	terms: Record<string, unknown>;
	expires_at?: string;
	user_approval_required: boolean;
	url?: string;
	confirmation: Confirmation | null;
	result: OperationResult | null;
}

export function operationJson(op: OperationRecord): OperationView {
	return {
		operation_id: op.id,
		revision: op.revision,
		state: op.state,
		summary: op.summary,
		terms: op.terms,
		...(op.state === "proposed" ? { expires_at: new Date(op.expiresAt).toISOString() } : {}),
		user_approval_required: op.userApprovalRequired,
		...(op.url ? { url: op.url } : {}),
		confirmation: op.confirmation,
		result: op.result,
	};
}

/** Whether the calling Personal Agent lists the operations extension, version 1, in its client metadata. */
export async function agentSupportsOperations(clients: ClientRegistry, clientId: string): Promise<boolean> {
	const ext = (await clients.load(clientId)).meta.extensions?.operations as { version?: unknown } | undefined;
	return ext?.version === "1";
}

/** A proposal's page, with `{id}` replaced by the operation ID. */
const withId = (url: string | undefined, id: string) => url?.replace("{id}", id);

const opKey = (id: string) => `operation:${id}`;
const isFinal = (op: OperationRecord) => op.result !== null;

export class Operations {
	private store: Store;
	private tools: ReadonlyMap<string, ToolDefinition>;

	constructor(store: Store, tools: ReadonlyMap<string, ToolDefinition>) {
		this.store = store;
		this.tools = tools;
	}

	/**
	 * Proposes the action a tool call describes, or returns the operation
	 * already open for it (extension 4): the same terms give the same
	 * revision, changed terms give the next revision.
	 */
	async propose(name: string, tool: OperationTool, input: unknown, ctx: SessionContext): Promise<OperationRecord> {
		const proposal = await tool.operation.propose(input, ctx);
		const owner = { sessionId: ctx.sessionId, clientId: ctx.clientId, userId: ctx.userId, account: ctx.account };
		const expiresAt = Date.now() + (proposal.expiresIn ?? 15 * 60) * 1000;
		const terms = { summary: proposal.summary, terms: proposal.terms, userApprovalRequired: proposal.userApprovalRequired ?? false, url: proposal.url, expiresAt };
		const fresh = (): OperationRecord => {
			const id = randomId("op");
			return { id, tool: name, key: proposal.key, owner, scope: tool.scope, revision: 1, state: "proposed", confirmation: null, result: null, ...terms, url: withId(terms.url, id) };
		};
		if (proposal.key === undefined) return this.save(fresh());

		// The same action in the same Session (or account) is one operation, whichever channel proposes it.
		const indexKey = `operation-key:${owner.account ? `acct:${owner.clientId}:${owner.userId}:${owner.account.id}` : `ses:${owner.sessionId}`}:${name}:${proposal.key}`;
		for (;;) {
			const existingId = await this.store.get<string>(indexKey);
			const existing = existingId ? await this.read(existingId) : undefined;
			if (!existing || isFinal(existing)) {
				const op = await this.save(fresh());
				// Another channel may have proposed the same action at the same moment; theirs wins.
				const won = existingId
					? (await this.store.update<string>(indexKey, (current) => (current === existingId ? op.id : undefined))) === op.id
					: await this.store.add(indexKey, op.id, { expiresAt: Date.now() + RETAIN_MS });
				if (won) return op;
				continue;
			}
			if (existing.state !== "proposed") return existing;
			const same = canonical([existing.summary, existing.terms, existing.userApprovalRequired]) === canonical([proposal.summary, proposal.terms, proposal.userApprovalRequired ?? false]);
			if (same) return existing;
			// New terms: the next revision of the same operation. Earlier revisions are never edited (extension 3.1).
			const revised = await this.transition(existing.id, (current) =>
				current.state === "proposed" && current.revision === existing.revision ? { ...current, ...terms, url: withId(terms.url, current.id), revision: current.revision + 1 } : undefined,
			);
			if (revised) return revised;
		}
	}

	/** Reads an operation, moving a proposal past its expires_at to expired. */
	async read(id: string): Promise<OperationRecord | undefined> {
		const op = await this.store.get<OperationRecord>(opKey(id));
		if (op?.state !== "proposed" || op.expiresAt > Date.now()) return op;
		return (
			(await this.transition(id, (current) =>
				current.state === "proposed" && current.expiresAt <= Date.now()
					? { ...current, state: "expired", confirmation: null, result: { summary: "Not confirmed in time. Nothing was done." } }
					: undefined,
			)) ?? this.store.get<OperationRecord>(opKey(id))
		);
	}

	/** An operation the caller may use (extension 3.2), or operation_not_found. */
	async owned(id: string, ctx: SessionContext): Promise<OperationRecord> {
		const op = await this.read(id);
		const o = op?.owner;
		const notFound = () => new PoppyError(404, "operation_not_found", "no such operation for this Session");
		if (!op || !o) throw notFound();
		// Proposed signed out: its own Session only.
		if (o.account === null) {
			if (o.sessionId !== ctx.sessionId) throw notFound();
			return op;
		}
		// Proposed signed in: any Session of the same agent and User signed in to that account now, the original one included.
		if (o.clientId !== ctx.clientId || o.userId !== ctx.userId) throw notFound();
		if (ctx.account === null) throw scopeError(op.scope ?? o.account.scopes.join(" "));
		if (ctx.account.id !== o.account.id) throw notFound();
		return op;
	}

	/** POST {endpoint}/{id}/confirm (extension 5.2). `settled` resolves when perform has finished. */
	async confirm(id: string, auth: Guarded, body: unknown): Promise<{ op: OperationRecord; settled: Promise<void> }> {
		const op = await this.owned(id, auth.ctx);
		auth.require(op.scope);
		const { revision, approved_by } = (body ?? {}) as { revision?: unknown; approved_by?: unknown };
		if (typeof revision !== "number" || (approved_by !== "user" && approved_by !== "standing_permission")) {
			throw invalidRequest('the body must be {"revision": number, "approved_by": "user" | "standing_permission"}');
		}
		// Anything but an open proposal comes back as it is, so a repeated confirm is safe.
		if (op.state !== "proposed") return { op, settled: Promise.resolve() };
		if (revision !== op.revision) {
			throw new PoppyError(409, "terms_changed", `revision ${op.revision} is the latest`, { body: { operation: operationJson(op) } });
		}
		if (op.userApprovalRequired && approved_by !== "user") {
			throw new PoppyError(403, "user_approval_required", "this operation needs the User's own approval of this revision", { body: { operation: operationJson(op) } });
		}
		return this.claim(op, revision, approved_by, auth.ctx);
	}

	/** An operation proposed signed in to this account, or undefined. */
	async ownedBy(id: string, accountId: string): Promise<OperationRecord | undefined> {
		const op = await this.read(id);
		return op?.owner.account?.id === accountId ? op : undefined;
	}

	/**
	 * Approval by the account holder signed in to the Company's own website,
	 * not by the Personal Agent. The caller has already checked who they are.
	 * It is the same operation as at the endpoint, so it can't run twice.
	 */
	async approve(id: string, accountId: string, revision: number): Promise<{ op: OperationRecord; settled: Promise<void> }> {
		const op = await this.ownedBy(id, accountId);
		const owner = op?.owner;
		if (!op || !owner?.account) throw new PoppyError(404, "operation_not_found", "no such operation for this account");
		if (op.state !== "proposed") return { op, settled: Promise.resolve() };
		if (revision !== op.revision) {
			throw new PoppyError(409, "terms_changed", `revision ${op.revision} is the latest`, { body: { operation: operationJson(op) } });
		}
		return this.claim(op, revision, "user", { sessionId: owner.sessionId, clientId: owner.clientId, userId: owner.userId, account: owner.account });
	}

	/** The one transition that lets the action run: proposed to in_progress, once. */
	private async claim(op: OperationRecord, revision: number, approved_by: Confirmation["approved_by"], ctx: SessionContext): Promise<{ op: OperationRecord; settled: Promise<void> }> {
		const confirmation = { revision, approved_by, confirmed_at: new Date().toISOString() } as const;
		const claimed = await this.transition(op.id, (current) =>
			current.state === "proposed" && current.revision === revision && current.expiresAt > Date.now()
				? { ...current, state: "in_progress", confirmation, result: null }
				: undefined,
		);
		if (!claimed || claimed.state !== "in_progress") return { op: (await this.read(op.id)) ?? op, settled: Promise.resolve() };
		return { op: claimed, settled: this.perform(claimed, ctx) };
	}

	/** POST {endpoint}/{id}/cancel (extension 7). */
	async cancel(id: string, ctx: SessionContext): Promise<OperationRecord> {
		const op = await this.owned(id, ctx);
		if (op.state === "proposed") {
			const cancelled = await this.transition(id, (current) =>
				current.state === "proposed" ? { ...current, state: "cancelled", result: { summary: "Cancelled before it was confirmed. Nothing was done." } } : undefined,
			);
			return cancelled ?? this.owned(id, ctx);
		}
		if (op.state !== "in_progress") return op;
		const stopped = await this.toolOf(op)?.operation.cancel?.({ id: op.id, terms: op.terms, summary: op.summary }, ctx);
		return (stopped && (await this.settle(id, "cancelled", stopped))) || op;
	}

	/**
	 * Records the outcome of an operation that is in progress. Use it when
	 * `perform` couldn't tell whether the action took effect and you found out
	 * later. Final operations never change.
	 */
	settle(id: string, state: "succeeded" | "failed" | "cancelled", result: OperationResult): Promise<OperationRecord | undefined> {
		return this.transition(id, (current) => (current.state === "in_progress" ? { ...current, state, result } : undefined));
	}

	/** Runs the tool's perform for the confirmed revision's terms, and settles the operation. */
	private async perform(op: OperationRecord, ctx: SessionContext): Promise<void> {
		try {
			const tool = this.toolOf(op);
			if (!tool) throw new Error(`tool ${op.tool} no longer exists`);
			const result = await tool.operation.perform({ id: op.id, terms: op.terms, summary: op.summary }, ctx);
			await this.settle(op.id, "succeeded", result);
		} catch (error) {
			if (error instanceof OperationFailed) {
				await this.settle(op.id, "failed", { summary: error.message, ...(error.data ? { data: error.data } : {}) });
				return;
			}
			// Unknown outcome: the operation stays in_progress until settle() records what happened (extension 6).
			console.error(`[poppyseed] operation ${op.id} (${op.tool}) threw; it stays in_progress until settled`, error);
		}
	}

	private toolOf(op: OperationRecord): OperationTool | undefined {
		const tool = this.tools.get(op.tool);
		return tool?.operation ? tool : undefined;
	}

	private async save(op: OperationRecord): Promise<OperationRecord> {
		await this.store.set(opKey(op.id), op, { expiresAt: Date.now() + RETAIN_MS });
		return op;
	}

	/** Applies `change` atomically. Resolves to the new record only if this call changed it. */
	private async transition(id: string, change: (current: OperationRecord) => OperationRecord | undefined): Promise<OperationRecord | undefined> {
		let changed: OperationRecord | undefined;
		await this.store.update<OperationRecord>(opKey(id), (current) => (changed = current && change(current)), { expiresAt: Date.now() + RETAIN_MS });
		return changed;
	}
}

/** The routes under the operations endpoint: GET {id}, POST {id}/confirm, POST {id}/cancel. */
export async function operationsEndpoint(request: Request, operations: Operations, auth: Guarded, id: string, action: "read" | "confirm" | "cancel", confirmWaitMs: number, waitUntil?: (promise: Promise<unknown>) => void): Promise<Response> {
	let op: OperationRecord;
	if (action === "confirm") {
		const confirmed = await operations.confirm(id, auth, await strictJson(request));
		waitUntil?.(confirmed.settled);
		// Wait a few seconds for a final state; otherwise answer in_progress with Retry-After.
		await Promise.race([confirmed.settled, new Promise((resolve) => setTimeout(resolve, confirmWaitMs))]);
		op = (await operations.read(id)) ?? confirmed.op;
	} else {
		op = action === "cancel" ? await operations.cancel(id, auth.ctx) : await operations.owned(id, auth.ctx);
	}
	const headers: Record<string, string> = { "cache-control": "no-store" };
	if (op.state === "in_progress") headers["retry-after"] = "2";
	return json(operationJson(op), 200, headers);
}
