/**
 * Who must approve an agent's payment or transfer. A customer with the Protea app on a phone approves every one there,
 * whatever its size, and nothing else counts: not their agent, not the website. Without a phone, only an amount over the
 * limit needs the customer themselves, and a smaller one may be confirmed under a standing permission.
 */
export function approvalPolicy(overLimit: boolean, hasPhone: boolean, noun: "payment" | "transfer"): { userApprovalRequired: boolean; approvalOnSite: boolean; note: string } {
	return {
		userApprovalRequired: overLimit || hasPhone,
		approvalOnSite: hasPhone,
		note: hasPhone ? " The customer must approve it in the Protea app on their phone." : overLimit ? ` This ${noun} is over the limit for a standing permission, so you must approve it yourself.` : "",
	};
}
