import { poppyseed } from "../poppyseed.config";
import { BRANCHES, RATES } from "../lib/products";
import { ProteaMark } from "./protea-mark";

export const dynamic = "force-dynamic";

const percent = (n: number) => `${n.toFixed(2)}%`;

export default function Home() {
	const { urls } = poppyseed;
	const endpoints = [
		["Discovery", urls.poppyJson],
		["OAuth metadata", urls.authorizationServer],
		["Token", urls.token],
		["Sign-in", `${urls.authorize} · ${urls.deviceAuthorization}`],
		["MCP tools", urls.mcp],
		["OpenAPI", urls.openapi],
	];
	return (
		<main>
			<header className="hero home">
				<div className="bloom"><ProteaMark size={300} /></div>
				<p className="kicker">Agent-ready banking · Paarl, South Africa</p>
				<h1>Protea Bank</h1>
				<p className="lede">Your money, in your hands or in your personal agent's. It can read our rates and find a branch without signing in. Anything that touches your money needs your sign-in, and anything large needs your own approval. Every amount is in rand.</p>
			</header>

			<section aria-labelledby="rates">
				<h2 id="rates">Rates</h2>
				<div className="card scroll">
					<table className="table">
						<thead>
							<tr><th>Product</th><th className="r">Rate</th><th>Term</th><th>Notes</th></tr>
						</thead>
						<tbody>
							{RATES.map((r) => (
								<tr key={r.name}>
									<td><strong>{r.name}</strong></td>
									<td className="r num">{percent(r.rate_percent)}<div className="muted">{r.kind === "earned" ? "earned" : "charged"}</div></td>
									<td>{r.term ?? "None"}</td>
									<td className="muted">{r.notes}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section aria-labelledby="branches">
				<h2 id="branches">Branches</h2>
				<div className="grid">
					{BRANCHES.map((b) => (
						<div className="card" key={b.id}>
							<strong>{b.name}</strong>
							<div className="muted">{b.address}</div>
							<div>{b.hours}</div>
							<div className="muted">{b.atm ? "ATM on site" : "No ATM"}</div>
						</div>
					))}
				</div>
			</section>

			<section aria-labelledby="agents">
				<h2 id="agents">For your personal agent</h2>
				<p className="muted">Protea Bank speaks the Personal Agent Protocol. These are the addresses an agent starts from.</p>
				<dl className="card endpoints">
					{endpoints.map(([name, url]) => (
						<div key={name} style={{ display: "contents" }}>
							<dt>{name}</dt>
							<dd><code>{url}</code></dd>
						</div>
					))}
				</dl>
			</section>
		</main>
	);
}
