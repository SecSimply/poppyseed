"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { startPhoneSignin, type StartPhone } from "./actions";

type Seen = "pending" | "used" | "expired";

/**
 * Add a phone for sign-in: a QR code for the Protea app to scan. The code works once. The page asks the bank every two
 * seconds whether the phone has used it, and says so when it has.
 */
export function AddPhone({ full }: { full: boolean }) {
	const router = useRouter();
	const [started, setStarted] = useState<StartPhone | undefined>();
	const [seen, setSeen] = useState<Seen>("pending");
	const code = started?.ok ? started.id : undefined;

	useEffect(() => {
		if (!code || seen !== "pending") return;
		const timer = setInterval(async () => {
			const res = await fetch(`/account/signin-phone/status?e=${encodeURIComponent(code)}`, { cache: "no-store" }).catch(() => undefined);
			if (!res?.ok) return;
			const next = ((await res.json()) as { state: Seen }).state;
			setSeen(next);
			if (next === "used") router.refresh();
		}, 2000);
		return () => clearInterval(timer);
	}, [code, seen, router]);

	if (seen === "used") {
		return (
			<div className="card" role="status">
				<p><strong>Your phone is added.</strong> It can now sign you in.</p>
				<button type="button" className="secondary" onClick={() => { setStarted(undefined); setSeen("pending"); }}>Done</button>
			</div>
		);
	}
	if (started?.ok && seen === "pending") {
		return (
			<div className="card">
				<p>Open the Protea app on your phone and scan this code. It works once, for ten minutes.</p>
				<svg viewBox={`-4 -4 ${started.qr.size + 8} ${started.qr.size + 8}`} role="img" aria-label="Code for the Protea app to scan" width={240} height={240} shapeRendering="crispEdges">
					<rect x={-4} y={-4} width={started.qr.size + 8} height={started.qr.size + 8} fill="#fff" />
					<path d={started.qr.path} fill="#000" />
				</svg>
				<details>
					<summary className="muted">Cannot scan? The link for the app, or for testing</summary>
					<p className="num" style={{ overflowWrap: "anywhere" }}>{started.link}</p>
				</details>
			</div>
		);
	}
	return (
		<div className="card">
			{seen === "expired" && <p role="alert">That code ran out. Make a new one.</p>}
			{started && !started.ok && <p role="alert">{started.message}</p>}
			{full ? (
				<p className="muted">You have the most phones allowed. Remove one to add another.</p>
			) : (
				<button type="button" onClick={async () => { setSeen("pending"); setStarted(await startPhoneSignin()); }}>Add a phone for sign-in</button>
			)}
		</div>
	);
}
