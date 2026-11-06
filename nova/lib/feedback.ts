import type { PoppyseedConfig } from "poppyseed";
import { excludedTaskOf } from "./excluded.ts";

type Report = Parameters<NonNullable<PoppyseedConfig["feedback"]>>[0];
type Advice = Awaited<ReturnType<NonNullable<PoppyseedConfig["feedback"]>>>;

/** What agents have told the bank they could not do. Data for people to read, never given to a model as instructions. */
export interface Received {
	at: string;
	clientId: string;
	task: string;
	description: string;
}

declare global {
	var __proteaReports: Received[] | undefined;
}
export const MAX_REPORTS = 100;
export const reports: Received[] = (globalThis.__proteaReports ??= []);

/** Keeps the newest reports. The text is stored as it came, and shown only as text. */
export function remember(report: Report, clientId: string, now = new Date()): void {
	reports.unshift({ at: now.toISOString(), clientId, task: report.task, description: report.description });
	reports.length = Math.min(reports.length, MAX_REPORTS);
}

/**
 * When the task can be done after all, say how: the answer to an agent that reported something we already offer.
 * Returns nothing for a task that is missing, which is the report's purpose.
 */
export function adviceFor(report: Report): Advice {
	const text = `${report.task} ${report.description}`;
	const excluded = excludedTaskOf(text);
	if (excluded) return { instructions: `${excluded.task}: ${excluded.instructions}` };
	if (/\b(statement|transactions?|spent|spending)\b/i.test(text)) return { instructions: "Transactions on an account are listed with list_transactions, with the transactions:read scope.", references: [{ tool: "list_transactions" }] };
	if (/\b(balance|how much)\b/i.test(text)) return { instructions: "Balances are listed with list_accounts, with the accounts:read scope.", references: [{ tool: "list_accounts" }] };
}
