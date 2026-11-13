"use server";

import { revalidatePath } from "next/cache";
import { phoneSignin, PhoneSigninError, type Started } from "../../../lib/phone-signin.ts";
import { ownBrowserCustomerId } from "../../../lib/viewer.ts";

export type StartPhone = Extract<Started, { ok: true }> | { ok: false; message: string };

/** Makes a one-time code for the signed-in customer and returns what the QR code holds. The code is only in this answer, once. */
export async function startPhoneSignin(): Promise<StartPhone> {
	const owner = await ownBrowserCustomerId();
	if (!owner) return { ok: false, message: "Sign in to Protea Bank in this browser first." };
	const service = phoneSignin();
	if (!service) return { ok: false, message: "Phone sign-in is not switched on." };
	try {
		const started = await service.start(owner);
		if (!started.ok) return { ok: false, message: "You already have the most phones allowed. Remove one before you add another." };
		return started;
	} catch (error) {
		if (!(error instanceof PhoneSigninError)) throw error;
		return { ok: false, message: "Phone sign-in is not available right now. Try again in a few minutes." };
	}
}

/** The customer removes one of their phones. The service removes it only if it is theirs. */
export async function removePhone(form: FormData): Promise<void> {
	const owner = await ownBrowserCustomerId();
	const service = phoneSignin();
	const id = String(form.get("device_id") ?? "");
	if (owner && service && id) {
		try {
			await service.remove(owner, id);
		} catch (error) {
			if (!(error instanceof PhoneSigninError)) throw error;
		}
	}
	revalidatePath("/account");
}
