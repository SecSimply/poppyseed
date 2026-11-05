// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo, InspectorConfig, ProtocolEvent } from "../shared/events.ts";

const api = vi.hoisted(() => ({
	getAuthInfo: vi.fn(),
	getConfig: vi.fn(),
	startRun: vi.fn(),
	streamRun: vi.fn(),
	decide: vi.fn(),
	cancelRun: vi.fn(),
	logout: vi.fn(),
}));
vi.mock("./api.ts", () => ({ ...api, Unauthorized: class Unauthorized extends Error {} }));

import { App } from "./App.tsx";

const config: InspectorConfig = { target: "https://site.example", clientId: "https://inspector.example/agent/client.json", redacted: true, faults: [], operations: [{ label: "book_flight" }] };
const signedIn: AuthInfo = { oidc: true, token: false, user: { sub: "abc", email: "dev@example.com" } };

const http = (step: string, status: number): ProtocolEvent =>
	({
		type: "http",
		step,
		ms: 12,
		request: { method: "POST", url: "https://site.example/oauth/token", headers: { authorization: "[redacted]" }, body: "{}" },
		response: { status, headers: {}, body: JSON.stringify({ error: "invalid_dpop_proof" }) },
	}) as unknown as ProtocolEvent;

/** Plays a script of events as if the server had streamed them, then ends the stream. */
const stream = (events: ProtocolEvent[]) => api.streamRun.mockImplementation(async (_t: string, _id: string, on: (e: ProtocolEvent) => void) => events.forEach(on));

beforeEach(() => {
	api.getConfig.mockResolvedValue(config);
	api.startRun.mockResolvedValue("run-1");
	api.decide.mockResolvedValue(undefined);
	api.logout.mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("login screen", () => {
	it("offers Curity and no token form when only Curity is configured", async () => {
		api.getAuthInfo.mockResolvedValue({ oidc: true, token: false } satisfies AuthInfo);
		render(<App />);
		const link = await screen.findByRole("link", { name: /sign in with curity/i });
		expect(link.getAttribute("href")).toBe("/auth/login");
		expect(screen.queryByLabelText(/access token/i)).toBeNull();
		expect(screen.queryByRole("button", { name: /run journey/i })).toBeNull();
	});

	it("offers the token form when a token is configured", async () => {
		api.getAuthInfo.mockResolvedValue({ oidc: false, token: true } satisfies AuthInfo);
		render(<App />);
		expect(await screen.findByLabelText(/access token/i)).toBeTruthy();
		expect(screen.queryByRole("link", { name: /curity/i })).toBeNull();
	});

	it("shows the person and the run controls once signed in, and returns to the login screen on sign out", async () => {
		api.getAuthInfo.mockResolvedValueOnce(signedIn).mockResolvedValue({ oidc: true, token: false });
		render(<App />);
		expect(await screen.findByText("dev@example.com")).toBeTruthy();
		expect(screen.getByRole("button", { name: /run journey/i })).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
		expect(api.logout).toHaveBeenCalled();
		expect(await screen.findByRole("link", { name: /sign in with curity/i })).toBeTruthy();
	});
});

describe("a run", () => {
	it("shows a failing step with its error and opens the failing exchange", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		stream([
			{ type: "run.start", signIn: false } as unknown as ProtocolEvent,
			{ type: "step.start", step: "session", title: "Start a Session" } as unknown as ProtocolEvent,
			http("session", 400),
			{ type: "step.end", step: "session", ok: false, summary: [], error: "token request refused" } as unknown as ProtocolEvent,
			{ type: "run.end", ok: false } as unknown as ProtocolEvent,
		]);
		render(<App />);
		await userEvent.click(await screen.findByRole("button", { name: /^run journey/i }));
		expect(await screen.findByText("token request refused")).toBeTruthy();
		expect(screen.getByText(/stopped at a failing step/i)).toBeTruthy();
		const exchange = document.querySelector("details.exchange") as HTMLDetailsElement;
		expect(exchange.open).toBe(true);
		expect(within(exchange).getByText(/invalid_dpop_proof/)).toBeTruthy();
	});
});

describe("action panel", () => {
	const wait = (action: Record<string, unknown>) => stream([{ type: "run.start", signIn: true } as unknown as ProtocolEvent, { type: "action.required", title: "Needs a person", lines: ["Ask them."], ...action } as unknown as ProtocolEvent]);

	it("shows the device code and an https link, with no approve buttons", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		wait({ kind: "device-signin", code: "WDJB-MJHT", link: "https://site.example/device" });
		render(<App />);
		await userEvent.click(await screen.findByRole("button", { name: /sign-in and operations/i }));
		const panel = await screen.findByRole("alert");
		expect(within(panel).getByText("WDJB-MJHT")).toBeTruthy();
		expect(within(panel).getByRole("link").getAttribute("href")).toBe("https://site.example/device");
		expect(within(panel).queryByRole("button", { name: /approve/i })).toBeNull();
	});

	it("does not render a link that is not http or https", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		wait({ kind: "open-link", link: "javascript:alert(1)" });
		render(<App />);
		await userEvent.click(await screen.findByRole("button", { name: /sign-in and operations/i }));
		const panel = await screen.findByRole("alert");
		expect(within(panel).queryByRole("link")).toBeNull();
	});

	it("sends the person's decision for an operation", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		wait({ kind: "approve-operation" });
		render(<App />);
		await userEvent.click(await screen.findByRole("button", { name: /sign-in and operations/i }));
		await userEvent.click(await within(await screen.findByRole("alert")).findByRole("button", { name: /^approve$/i }));
		await waitFor(() => expect(api.decide).toHaveBeenCalledWith("", "run-1", "approve"));
		expect(api.decide).toHaveBeenCalledTimes(1);
	});

	it("removes the panel once the run has ended", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		stream([
			{ type: "action.required", kind: "approve-operation", title: "Needs a person", lines: [] } as unknown as ProtocolEvent,
			{ type: "run.end", ok: false } as unknown as ProtocolEvent,
		]);
		render(<App />);
		await userEvent.click(await screen.findByRole("button", { name: /sign-in and operations/i }));
		await screen.findByText(/stopped at a failing step/i);
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("hints, tokens and fault tests", () => {
	const refused = (extra: Record<string, unknown>) =>
		({
			type: "http",
			step: "session",
			ms: 4,
			request: { method: "POST", url: "https://site.example/oauth/token", headers: {}, body: "x=1" },
			response: { status: 400, headers: {}, body: JSON.stringify({ error: "invalid_dpop_proof" }) },
			...extra,
		}) as unknown as ProtocolEvent;

	const failedRun = (http: ProtocolEvent) => [
		{ type: "run.start", signIn: false } as unknown as ProtocolEvent,
		{ type: "step.start", step: "session", title: "Start a Session" } as unknown as ProtocolEvent,
		http,
		{ type: "step.end", step: "session", ok: false, summary: [], error: "refused" } as unknown as ProtocolEvent,
		{ type: "run.end", ok: false } as unknown as ProtocolEvent,
	];

	it("shows the likely causes next to a refusal", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		stream(failedRun(refused({ hints: ["Check that htu is the request URL."] })));
		render(<App />);
		await userEvent.click(await screen.findByRole("button", { name: /^run journey/i }));
		const hints = await screen.findByLabelText("Likely causes");
		expect(within(hints).getByText(/htu is the request URL/)).toBeTruthy();
	});

	it("opens a token with failing checks, shows what failed, and says the signature is not shown", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		const jwt = {
			where: "DPoP header",
			kind: "DPoP proof",
			header: { typ: "dpop+jwt" },
			claims: { htm: "GET" },
			checks: [
				{ name: "htm", status: "fail", detail: 'htm is "GET"; this request is POST' },
				{ name: "typ", status: "pass", detail: "dpop+jwt" },
			],
		};
		stream(failedRun(refused({ jwts: [jwt] })));
		render(<App />);
		await userEvent.click(await screen.findByRole("button", { name: /^run journey/i }));
		expect(await screen.findByText(/1 check failed/)).toBeTruthy();
		const details = document.querySelector("details.jwt") as HTMLDetailsElement;
		expect(details.open).toBe(true);
		expect(within(details).getByText(/this request is POST/)).toBeTruthy();
		expect(within(details).getByText(/signature is not shown/i)).toBeTruthy();
	});

	it("starts a fault test with the chosen fault, and only once one is chosen", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		api.getConfig.mockResolvedValue({ ...config, faults: [{ id: "dpop-stale", title: "Stale DPoP proof", rule: "A proof's iat must be recent." }] });
		stream([{ type: "run.start", signIn: false, fault: "dpop-stale" } as unknown as ProtocolEvent, { type: "run.end", ok: true } as unknown as ProtocolEvent]);
		render(<App />);
		const button = await screen.findByRole("button", { name: /run fault test/i });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		await userEvent.selectOptions(screen.getByRole("combobox"), "dpop-stale");
		expect(screen.getByText("A proof's iat must be recent.")).toBeTruthy();
		await userEvent.click(button);
		await waitFor(() => expect(api.startRun).toHaveBeenCalledWith("", false, "dpop-stale", undefined));
		expect(await screen.findByText("refused as required")).toBeTruthy();
	});

	it("lets the person choose which operation the longer run proposes, and sends that choice", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		api.getConfig.mockResolvedValue({ ...config, operations: [{ label: "Pay the energy bill, $96.40" }, { label: "Pay the rent, $1,450.00" }] });
		stream([{ type: "run.start", signIn: true } as unknown as ProtocolEvent, { type: "run.end", ok: true } as unknown as ProtocolEvent]);
		render(<App />);
		const picker = await screen.findByRole("combobox", { name: /operation/i });
		await userEvent.selectOptions(picker, "Pay the rent, $1,450.00");
		await userEvent.click(screen.getByRole("button", { name: /sign-in and operations/i }));
		await waitFor(() => expect(api.startRun).toHaveBeenCalledWith("", true, undefined, 1));
	});

	it("offers no operation picker when there is only one operation", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		render(<App />);
		await screen.findByRole("button", { name: /^run journey/i });
		expect(screen.queryByRole("combobox", { name: /operation/i })).toBeNull();
	});

	it("offers no fault picker when the server lists no faults", async () => {
		api.getAuthInfo.mockResolvedValue(signedIn);
		api.getConfig.mockResolvedValue({ ...config, faults: [] });
		render(<App />);
		await screen.findByRole("button", { name: /^run journey/i });
		expect(screen.queryByRole("button", { name: /run fault test/i })).toBeNull();
	});
});
