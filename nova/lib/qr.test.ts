import { create } from "qrcode";
import { expect, it } from "vitest";
import { qr } from "./qr.ts";

/** Reads the path back into the grid it draws. */
function grid(size: number, path: string): boolean[][] {
	const cells = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
	for (const [, x, y, run] of [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)].map((m) => [m[0], Number(m[1]), Number(m[2]), Number(m[3])] as const)) {
		for (let i = 0; i < run; i++) cells[y]![x + i] = true;
	}
	return cells;
}

it("draws exactly the dark modules of the code", () => {
	const text = "protea://enroll?o=https%3A%2F%2Fapp.proteabank.co.za&e=enr_abc&s=0123456789abcdef0123456789abcdef";
	const { size, path } = qr(text);
	const { modules } = create(text, { errorCorrectionLevel: "M" });
	expect(size).toBe(modules.size);
	const drawn = grid(size, path);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) expect(drawn[y]![x], `${x},${y}`).toBe(Boolean(modules.get(y, x)));
});
