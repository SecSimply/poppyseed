/**
 * The browsing step: the agent's browser joins its Session on the company's website (spec 5) and loads some pages, so
 * the person running the inspector can see what that Session is shown. Only the page's text is kept: no markup and no
 * script reaches the inspector's UI.
 */

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&nbsp;": " " };

const textOf = (html: string) =>
	html
		.replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (e) => ENTITIES[e] ?? e)
		.replace(/ /g, " ")
		.replace(/\s+/g, " ")
		.trim();

/** A page's title and the start of its main text (the `<main>` element when it has one), as plain text. */
export function readPage(html: string, limit = 700): { title: string; excerpt: string } {
	const title = textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
	const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
	const text = textOf(main);
	return { title, excerpt: text.length > limit ? `${text.slice(0, limit)}…` : text };
}

/** Paths to load, from a space- or comma-separated list. Each must start with `/`; the default is the home page. */
export function parsePaths(text: string | undefined): string[] {
	const paths = (text ?? "").split(/[\s,]+/).filter((p) => /^\/[^\s]*$/.test(p) && !p.startsWith("//"));
	return paths.length ? [...new Set(paths)].slice(0, 10) : ["/"];
}

export interface Site {
	/** Has the browser join the Session. */
	join(): Promise<Response>;
	get(url: string): Promise<Response>;
	target: string;
}

/** Joins the browser and loads each path. A refusal to join fails the step; a page that is not 200 is reported, not hidden. */
export async function browse(site: Site, paths: string[]): Promise<string[]> {
	const joined = await site.join();
	if (joined.status >= 400) throw new Error(`the company did not let the browser join the Session: HTTP ${joined.status}`);
	const lines = [`the browser joined the Session (HTTP ${joined.status})`];
	for (const path of paths) {
		const url = new URL(path, site.target);
		if (url.origin !== new URL(site.target).origin) throw new Error(`${path} is not a page on ${site.target}`);
		const response = await site.get(url.toString());
		const where = `GET ${url.pathname}${url.search}`;
		if (response.status >= 300) {
			lines.push(`${where} → ${response.status}${response.headers.get("location") ? ` to ${response.headers.get("location")}` : ""}`);
			continue;
		}
		const page = readPage(await response.text());
		lines.push(`${where} → ${response.status} "${page.title}"`, `  ${page.excerpt}`);
	}
	return lines;
}
