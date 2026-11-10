/** A QR code as an SVG path, drawn by this code from the library's bit matrix: nothing from the library is put into a page as markup. */
import { create } from "qrcode";

export interface Qr {
	/** The code is `size` modules across and down. */
	size: number;
	/** One filled square per dark module, in runs along each row. */
	path: string;
}

export function qr(text: string): Qr {
	const { modules } = create(text, { errorCorrectionLevel: "M" });
	const size = modules.size;
	let path = "";
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; ) {
			if (!modules.get(y, x)) {
				x++;
				continue;
			}
			let run = 0;
			while (x + run < size && modules.get(y, x + run)) run++;
			path += `M${x} ${y}h${run}v1h-${run}z`;
			x += run;
		}
	}
	return { size, path };
}
