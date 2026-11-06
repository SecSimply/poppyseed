/**
 * Protea Bank's mark: a king protea seen from above, as in the photograph the brand is drawn from. Pointed crimson
 * bracts around a ring of rose ones, a cream collar, and a blush centre of fine needles. The colours are theme tokens,
 * so one drawing serves both themes. `app/icon.svg` is the same drawing in fixed colours.
 */
const ring = (count: number, offset: number) => Array.from({ length: count }, (_, i) => offset + (360 / count) * i);

/** A pointed bract, from near the centre out to its tip, drawn upright and then turned. */
const bract = (base: number, tip: number, half: number) => `M0,${-base}C${half * 1.15},${-(base + (tip - base) * 0.3)} ${half * 0.55},${-(base + (tip - base) * 0.85)} 0,${-tip}C${-half * 0.55},${-(base + (tip - base) * 0.85)} ${-half * 1.15},${-(base + (tip - base) * 0.3)} 0,${-base}Z`;

export function ProteaMark({ size = 24, title }: { size?: number; title?: string }) {
	return (
		<svg viewBox="-50 -50 100 100" width={size} height={size} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
			{ring(12, 0).map((a) => <path key={`o${a}`} d={bract(16, 48, 10)} transform={`rotate(${a})`} fill="var(--pr-bract)" />)}
			{ring(12, 15).map((a) => <path key={`i${a}`} d={bract(14, 36, 8)} transform={`rotate(${a})`} fill="var(--pr-tip)" />)}
			<circle r="24" fill="var(--pr-cream)" />
			<circle r="17" fill="var(--pr-centre)" />
			{ring(28, 0).map((a) => <line key={`n${a}`} y1="-4" y2="-15" transform={`rotate(${a})`} stroke="var(--pr-needle)" strokeWidth="1.2" strokeLinecap="round" />)}
		</svg>
	);
}
