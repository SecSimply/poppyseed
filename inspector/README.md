# Poppy Inspector

A protocol debugger. It runs a real Personal Agent (`poppyseed/agent`) against one Poppyseed site and shows every request the agent makes: method, URL, headers, bodies, status, timing, grouped by protocol step.

Phase 1 steps: discover, start a Session, list tools over MCP, call a public tool. A failing step stops the run and shows the company's error.

```
React UI  ⇄ SSE ⇄  backend (TestAgent; serves /agent/client.json and /agent/jwks.json)  ⇄  TARGET_URL
```

The agent's identity is hosted by this server on its own HTTPS origin, so the target fetches it like any agent's. Nothing needs loosening on the target.

## Configuration

| Variable | |
| --- | --- |
| `TARGET_URL` | The Poppyseed site to inspect. Required in production. |
| `INSPECTOR_TOKEN` | 16+ characters. Required in production: the server holds a live agent identity. The UI asks for it. |
| `INSPECTOR_PUBLIC_URL` | This server's public origin (default: `RAILWAY_PUBLIC_DOMAIN`, else localhost). It becomes the agent's `client_id`. |
| `INSPECTOR_REVEAL=1` | Show tokens and assertions unredacted. Off by default. |
| `PUBLIC_TOOL`, `PUBLIC_TOOL_ARGS` | The tool for the "call a public tool" step (JSON arguments). Defaults to the demo's `search_flights`; skipped if the target has no such tool. |

## Run

```sh
pnpm --filter poppyseed-inspector dev            # API on :3001 (TARGET_URL defaults to http://localhost:3000)
pnpm --filter poppyseed-inspector dev:ui      # UI with hot reload, proxying /api
pnpm --filter poppyseed-inspector build && pnpm --filter poppyseed-inspector start   # one server
```

A local run needs a target that accepts loopback agents (a Poppyseed site in development). Run one instance only: keys and runs live in the process.

## Not yet (later phases)

Sign-in and operations steps, JWT decoder, fault injection, run export/import, and requests the target makes to the agent's metadata URLs.
