"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { confirmDevice, rejectDevice, startEnrollment, type EnrollStart } from "./actions";

type Live = { state: "none" } | { state: "waiting"; id: string; name: string; code: string } | { state: "active"; id: string; name: string };

/**
 * Add a phone: a QR code for the Protea app to scan, then the code the app shows, which the customer compares and confirms
 * here. The page asks the bank every two seconds whether the app has claimed the code.
 */
export function Enroll({ initial }: { initial: Live }) {
	const router = useRouter();
	const [started, setStarted] = useState<EnrollStart | undefined>();
	const [live, setLive] = useState<Live>(initial);
	const watching = started?.ok === true || live.state === "waiting";

	useEffect(() => {
		if (!watching) return;
		const timer = setInterval(async () => {
			const res = await fetch("/account/devices/status", { cache: "no-store" }).catch(() => undefined);
			if (!res?.ok) return;
			const next = (await res.json()) as Live;
			setLive(next);
			if (next.state === "active") router.refresh();
		}, 2000);
		return () => clearInterval(timer);
	}, [watching, router]);

	if (live.state === "waiting") {
		return (
			<div className="card" role="status">
				<p><strong>{live.name}</strong> is asking to be your device.</p>
				<p>The code on your phone must be <strong className="num">{live.code}</strong>. Confirm only if it is, and the device is yours.</p>
				<form action={confirmDevice}>
					<input type="hidden" name="device_id" value={live.id} />
					<button type="submit">The codes match</button>
				</form>
				<form action={rejectDevice}>
					<input type="hidden" name="device_id" value={live.id} />
					<button type="submit" className="secondary">This is not my device</button>
				</form>
			</div>
		);
	}
	if (live.state === "active") return null;
	return (
		<div className="card">
			{started?.ok ? (
				<>
					<p>Open the Protea app on your phone and scan this code. It works once, for five minutes.</p>
					<svg viewBox={`-4 -4 ${started.qr.size + 8} ${started.qr.size + 8}`} role="img" aria-label="Code for the Protea app to scan" width={240} height={240} shapeRendering="crispEdges">
						<rect x={-4} y={-4} width={started.qr.size + 8} height={started.qr.size + 8} fill="#fff" />
						<path d={started.qr.path} fill="#000" />
					</svg>
					<details>
						<summary className="muted">Cannot scan? The link for the app, or for testing</summary>
						<p className="num" style={{ overflowWrap: "anywhere" }}>{started.link}</p>
					</details>
				</>
			) : (
				<>
					{started && <p role="alert">{started.message}</p>}
					<button type="button" onClick={async () => setStarted(await startEnrollment())}>Add my phone</button>
				</>
			)}
		</div>
	);
}
