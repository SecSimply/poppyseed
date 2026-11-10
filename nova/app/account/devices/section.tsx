import { devices } from "../../../lib/devices.ts";
import { Enroll } from "./enroll";

/** The customer's phone for approving agent payments: add one, or see the one they have. */
export async function DevicesSection({ customerId }: { customerId: string }) {
	const device = await (await devices()).liveOf(customerId);
	return (
		<section aria-labelledby="phone">
			<h2 id="phone">Your phone</h2>
			{device?.status === "active" ? (
				<div className="card">
					<p><strong>{device.name}</strong> approves every payment your personal agents ask for. The agents cannot approve them, and neither can this website.</p>
					<p className="muted">Added {new Date(device.createdAt).toLocaleDateString("en-ZA")}{device.lastSeenAt ? `, last seen ${new Date(device.lastSeenAt).toLocaleString("en-ZA")}` : ""}. To replace it, ask Protea Bank staff to remove it.</p>
				</div>
			) : (
				<>
					<p className="muted">With the Protea app on your phone, you approve every payment a personal agent asks for there, with your fingerprint. Nothing else can approve them.</p>
					<Enroll initial={device ? { state: "waiting", id: device.id, name: device.name, code: device.code } : { state: "none" }} />
				</>
			)}
		</section>
	);
}
