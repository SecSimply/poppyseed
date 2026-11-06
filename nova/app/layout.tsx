import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";
import { ProteaMark } from "./protea-mark";
import "./protea.css";

const sans = Manrope({ subsets: ["latin"], variable: "--f-sans", display: "swap" });
const serif = Fraunces({ subsets: ["latin"], variable: "--f-serif", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
	title: { default: "Protea Bank", template: "%s · Protea Bank" },
	description: "A fictional South African bank, headquartered in Paarl, that shows what your personal agent can do with the Personal Agent Protocol.",
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#fbf5f2" },
		{ media: "(prefers-color-scheme: dark)", color: "#0f1a13" },
	],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en-ZA" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
			<head>
				<link rel="alternate" type="application/json" href="/.well-known/poppy.json" title="Personal Agent Protocol" />
			</head>
			<body>
				<p className="demo-banner">Protea Bank is fictional and for demonstration only. No real money, accounts or people.</p>
				<div className="ribbon" aria-hidden="true" />
				<nav className="top">
					<div className="wrap">
						<a className="brand" href="/">
							<ProteaMark size={30} />
							Protea Bank
						</a>
						<a href="/payments">Payments</a>
						<a href="/payees">Payees</a>
						<a href="/account">Account</a>
						<a href="/staff">Staff</a>
					</div>
				</nav>
				{children}
				<footer className="site">
					<div className="wrap">
						<strong>Protea Bank</strong>
						<span>Head office: 1 Protea Plein, Main Street, Paarl, 7646, South Africa. Branch: 88 Church Street, Pretoria, 0002.</span>
						<span>Amounts are in South African rand (ZAR). Protea Bank (Pty) Ltd is fictional: it is not a registered bank and offers no real products.</span>
					</div>
				</footer>
			</body>
		</html>
	);
}
