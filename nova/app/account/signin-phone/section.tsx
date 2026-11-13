import { MAX_PHONES, phoneSignin, PhoneSigninError, type Phone } from "../../../lib/phone-signin.ts";
import { AddPhone } from "./add";
import { removePhone } from "./actions";

/** The customer's phones that can sign them in, with a way to add or remove one. Nothing at all unless the sign-in service is switched on. */
export async function PhoneSigninSection({ customerId }: { customerId: string }) {
	const service = phoneSignin();
	if (!service) return null;
	let phones: Phone[] | undefined;
	try {
		phones = await service.phones(customerId);
	} catch (error) {
		if (!(error instanceof PhoneSigninError)) throw error;
	}
	return (
		<section aria-labelledby="phone-signin">
			<h2 id="phone-signin">Sign in with your phone</h2>
			<p className="muted">Add a phone that signs you in with its fingerprint or face, without a password. You can have up to {MAX_PHONES}. This is separate from the phone that approves payments.</p>
			{phones === undefined ? (
				<p className="card" role="alert">Phone sign-in is not available right now. Try again in a few minutes.</p>
			) : (
				<>
					{phones.length > 0 && (
						<div className="card scroll">
							<table className="table">
								<tbody>
									{phones.map((p) => (
										<tr key={p.id}>
											<th scope="row">{p.label ?? "Phone"}</th>
											<td>
												<div className="muted">Added {new Date(p.addedAt).toLocaleDateString("en-ZA")}{p.lastUsedAt ? `, last used ${new Date(p.lastUsedAt).toLocaleString("en-ZA")}` : ", not used yet"}</div>
												<form action={removePhone}>
													<input type="hidden" name="device_id" value={p.id} />
													<button type="submit" className="secondary">Remove</button>
												</form>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<AddPhone full={phones.length >= MAX_PHONES} />
				</>
			)}
		</section>
	);
}
