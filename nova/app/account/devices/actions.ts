"use server";

import { revalidatePath } from "next/cache";
import { poppyseed } from "../../../poppyseed.config";
import { devices } from "../../../lib/devices.ts";
import { activateDevice } from "../../../lib/enrollment.ts";
import { baseUrl } from "../../../lib/env.ts";
import { qr, type Qr } from "../../../lib/qr.ts";
import { viewer } from "../../../lib/viewer.ts";

export type EnrollStart = { ok: true; expiresAt: number; qr: Qr; link: string } | { ok: false; message: string };

/** Only the customer in their own browser: an agent's browser, signed in or not, is refused, as at the payees page. */
async function customerId(): Promise<string | undefined> {
	const who = await viewer();
	return who.via === "site" ? who.customer.id : undefined;
}

/** Opens an enrollment and returns what the QR code holds. The secret is only in this answer, once. */
export async function startEnrollment(): Promise<EnrollStart> {
	const id = await customerId();
	if (!id) return { ok: false, message: "Sign in to Protea Bank in this browser first." };
	const started = await (await devices()).startEnrollment(id);
	if (!started.ok) return { ok: false, message: "You already have a device. Ask Protea Bank staff to remove it before you add another." };
	const link = `protea://enroll?${new URLSearchParams({ o: baseUrl, e: started.id, s: started.secret })}`;
	return { ok: true, expiresAt: started.expiresAt, qr: qr(link), link };
}

/** The customer sees the same code on the website and on the phone, and confirms the device is theirs. */
export async function confirmDevice(form: FormData): Promise<void> {
	const id = await customerId();
	if (id) await activateDevice(id, String(form.get("device_id") ?? ""), await devices(), poppyseed.operations);
	revalidatePath("/account");
}

/** The customer says a waiting device is not theirs. An active device can only be removed by staff. */
export async function rejectDevice(form: FormData): Promise<void> {
	const id = await customerId();
	const store = await devices();
	const live = id ? await store.liveOf(id) : undefined;
	if (id && live?.status === "waiting" && live.id === String(form.get("device_id") ?? "")) await store.remove(id, live.id);
	revalidatePath("/account");
}
