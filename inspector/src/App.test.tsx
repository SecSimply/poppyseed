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

const config: InspectorConfig = { target: "https://site.example", clientId: "https://inspector.example/agent/client.json", redacted: true } as InspectorConfig;
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
