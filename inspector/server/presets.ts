/** An operation the longer run can propose, with the label the person sees when choosing. */
export interface OperationPreset {
	label: string;
	name: string;
	arguments?: Record<string, unknown>;
}

/** What a run proposes when nothing is configured: Protea Bank's smallest demonstration payment. */
const DEFAULT: OperationPreset = { label: "Pay Boland Power R10,00", name: "pay_payee", arguments: { payee_id: "pye_thandi_energy", from_account_id: "acc_thandi_everyday", amount: "10.00", reference: "inspector" } };

const object = (text: string, name: string): Record<string, unknown> => {
	const value: unknown = JSON.parse(text);
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
	return value as Record<string, unknown>;
};

/**
 * OPERATIONS is a JSON list of {label, tool, arguments} the person picks from. Without it, OPERATION_TOOL and
 * OPERATION_ARGS give the one, which defaults to a small payment at Protea Bank.
 */
export function parseOperations(env: Record<string, string | undefined>): OperationPreset[] {
	if (!env.OPERATIONS) {
		const name = env.OPERATION_TOOL ?? DEFAULT.name;
		return [{ label: env.OPERATION_TOOL ?? DEFAULT.label, name, arguments: env.OPERATION_ARGS ? object(env.OPERATION_ARGS, "OPERATION_ARGS") : env.OPERATION_TOOL ? undefined : DEFAULT.arguments }];
	}
	const listed: unknown = JSON.parse(env.OPERATIONS);
	if (!Array.isArray(listed) || listed.length === 0 || listed.length > 10) throw new Error("OPERATIONS must be a JSON list of 1 to 10 operations");
	return listed.map((entry: unknown) => {
		const { label, tool, arguments: args } = (entry ?? {}) as Record<string, unknown>;
		if (typeof label !== "string" || !label || typeof tool !== "string" || !tool) throw new Error("each OPERATIONS entry needs a label and a tool");
		if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) throw new Error(`OPERATIONS entry "${label}": arguments must be an object`);
		return { label, name: tool, arguments: args as Record<string, unknown> | undefined };
	});
}
