/** The approval page is one click that moves money, and the account page shows the QR code that enrols a phone: no other site may frame either, and neither is cached. */
const noFramingNoCache = [
	{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
	{ key: "Cache-Control", value: "no-store" },
];

export const approvalHeaders = [
	{ source: "/payments/approve/:id", headers: noFramingNoCache },
	{ source: "/account", headers: noFramingNoCache },
];
