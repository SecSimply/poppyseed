/** The approval page is one click that moves money, so no other site may frame it, and it is never cached. */
export const approvalHeaders = [
	{
		source: "/payments/approve/:id",
		headers: [
			{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
			{ key: "Cache-Control", value: "no-store" },
		],
	},
];
