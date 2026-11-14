import { devices } from "../../../lib/devices.ts";
import { phoneSignin, PhoneSigninError } from "../../../lib/phone-signin.ts";
import { Enroll } from "./enroll";

/** Whether the customer's phone is also registered for signing in: undefined when the bank has no such service or it cannot be asked. */
async function signedIn(customerId: string): Promise<boolean | undefined> {
	const service = phoneSignin();
	if (!service) return undefined;
	try {
		return (await service.phones(customerId)).length > 0;
	} catch (error) {
		if (!(error instanceof PhoneSigninError)) throw error;
		return undefined;
	}
}

/** The customer's phone: add one, or see the one they have and what it is set up for. */
export async function DevicesSection({ customerId }: { customerId: string }) {
	const device = await (await devices()).liveOf(customerId);
	const signin = device?.status === "active" ? await signedIn(customerId) : undefined;
	return (
		<section aria-labelledby="phone">
			<h2 id="phone">Your phone</h2>
			{device?.status === "active" ? (
				<div className="card">
					<p><strong>{device.name}</strong> approves every payment your personal agents ask for. The agents cannot approve them, and neither can this website.</p>
					{signin === false && <p role="status">One more step: open the Protea app and press <strong>Finish setting up</strong>, so this phone is also registered for signing in.</p>}
					{signin === true && <p className="muted">It is also registered for signing in.</p>}
					<p className="muted">Added {new Date(device.createdAt).toLocaleDateString("en-ZA")}{device.lastSeenAt ? `, last seen ${new Date(device.lastSeenAt).toLocaleString("en-ZA")}` : ""}. To replace it, ask Protea Bank staff to remove it.</p>
				</div>
			) : (
				<>
					<p className="muted">With the Protea app on your phone, you approve every payment a personal agent asks for there, with your fingerprint. Nothing else can approve them. One setup also registers the phone for signing in.</p>
					<Enroll initial={device ? { state: "waiting", id: device.id, name: device.name, code: device.code } : { state: "none" }} />
				</>
			)}
		</section>
	);
}
