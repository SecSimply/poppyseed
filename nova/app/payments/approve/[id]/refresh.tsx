"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Looks again every three seconds, so the page shows the approval a moment after it is made on the phone. */
export function Refresh() {
	const router = useRouter();
	useEffect(() => {
		const timer = setInterval(() => router.refresh(), 3000);
		return () => clearInterval(timer);
	}, [router]);
	return null;
}
