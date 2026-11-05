/** An operation the longer run can propose, with the label the person sees when choosing. */
export interface OperationPreset {
	label: string;
	name: string;
	arguments?: Record<string, unknown>;
}

const object = (text: string, name: string): Record<string, unknown> => {
	const value: unknown = JSON.parse(text);
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
	return value as Record<string, unknown>;
};

/**
 * OPERATIONS is a JSON list of {label, tool, arguments} the person picks from. Without it, OPERATION_TOOL and
 * OPERATION_ARGS give the one, which defaults to the Poppy Travel demo's.
 */
export function parseOperations(env: Record<string, string | undefined>): OperationPreset[] {
	if (!env.OPERATIONS) {
		const name = env.OPERATION_TOOL ?? "book_flight";
		return [{ label: name, name, arguments: env.OPERATION_ARGS ? object(env.OPERATION_ARGS, "OPERATION_ARGS") : undefined }];
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
