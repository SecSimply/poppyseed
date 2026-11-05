import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./nova.css";

const sans = Manrope({ subsets: ["latin"], variable: "--f-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
	title: { default: "Nova Bank", template: "%s · Nova Bank" },
	description: "A fictional bank that shows what your personal agent can do with the Personal Agent Protocol.",
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
		{ media: "(prefers-color-scheme: dark)", color: "#0b1226" },
	],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`${sans.variable} ${mono.variable}`}>
			<head>
				<link rel="alternate" type="application/json" href="/.well-known/poppy.json" title="Personal Agent Protocol" />
			</head>
			<body>
				<p className="demo-banner">Nova Bank is fictional and for demonstration only. No real money, accounts or people.</p>
				<nav className="top">
					<div className="wrap">
						<a className="brand" href="/">
							<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
								<path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z" fill="var(--flare)" />
							</svg>
							Nova Bank
						</a>
						<a href="/account">Account</a>
					</div>
				</nav>
				{children}
			</body>
		</html>
	);
}
