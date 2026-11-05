# Poppy Inspector: architecture, decisions and next steps

A protocol debugger for developers. It runs a real Personal Agent against one Poppyseed site and shows every request, grouped by protocol step. This file records how it is built, why, and what comes next. For how to run and configure it, see [README.md](README.md).

## What it is for

Developers adding Poppyseed to a site need to see what an agent sees on the wire: which request failed, with what headers and body, and what the company said. The inspector is that view. It is a debugging tool for developers, not a teaching tool, so it favours raw detail over explanation.

Scope today: one target site (our own Railway deployment), one agent identity, one run at a time.

## Shape of the system

```
 Browser (React)                Inspector backend (Node)                       Target site
 ┌──────────────┐  /auth/*      ┌───────────────────────────────────┐          ┌───────────────┐
 │ step timeline│──────────────▶│ OIDC login (Curity, code + PKCE)  │          │ Poppyseed     │
 │ request viewer│  /api/*  SSE │ run controller + event stream     │  HTTPS   │ (poppy.json,  │
 │ action panel │◀─────────────▶│ TestAgent (poppyseed/agent)       │─────────▶│ /oauth, /mcp, │
 └──────────────┘               │ capture + redaction (fetch wrap)  │          │ /poppy/tools) │
                                │ /agent/client.json, /agent/jwks   │◀─────────│ fetches agent │
                                └───────────────────────────────────┘ metadata └───────────────┘
```

- **`server/index.ts`**: the HTTP server. Routes for the agent's public identity, Curity login, the run API, and the built UI. Sessions, runs and login state live in process memory.
- **`server/journey.ts`**: the steps. Each step reports a title and summary; a failing step stops the run. Sign-out always runs if a sign-in happened.
- **`server/capture.ts`**: wraps the agent's `fetch`, so every request it makes is reported as an `http` event tagged with the current step. It redacts credentials before anything leaves the server.
- **`server/oidc.ts`**: the OpenID Connect client (authorization code with PKCE) and the allow-list.
- **`shared/events.ts`**: the one event type shared by backend and UI. A run is a list of these.
- **`src/`**: the React UI. It folds events into steps, renders exchanges, and shows a panel when the run is waiting for a person.
- **`scripts/`**: `e2e-local.ts` plays the approving person against a local demo site; `mock-oidc.ts` stands in for Curity locally.

### The journey

| Step | What happens | Needs a person |
| --- | --- | --- |
| discover | `poppy.json` and the authorization server metadata | no |
| session | JWT-bearer grant with a client assertion, DPoP-bound | no |
| tools | MCP `tools/list` with a token bound to the MCP resource | no |
| call | a public tool over MCP (default `search_flights`) | no |
| signin | Device Sign-In: link and code shown, the inspector polls | yes: approves on the company's page |
| account | a scoped tool over the HTTP API (default `my_trips`) | no |
| propose | an action tool returns an operation (default `book_flight`) | no |
| approve | the person approves or declines; the agent confirms or cancels | yes: in the UI, or on the company's page if the operation requires it |
| signout | revokes the Account Token | no |

The first four run with "Run journey". All nine run with "Run with sign-in and operations".

## Decisions

Each is recorded with the alternative that was not taken.

**1. A backend drives the agent; the browser only displays.**
An agent must serve client metadata at an HTTPS `client_id`, hold private keys, and sign client assertions and DPoP proofs. A browser can do none of that safely. So the Node backend runs `TestAgent` and streams events to the React UI over SSE. *Alternative: a browser-only app. Rejected: it cannot be an agent.*

**2. The agent's identity is hosted by the inspector, on its own HTTPS origin.**
`client_id` is `<inspector origin>/agent/client.json`, with the JWKS next to it. The target fetches them like any agent's, so nothing is loosened on the target (`dev.allowInsecureClients` stays off). *Alternative: loopback `http://127.0.0.1` agents, as `poppyseed check` uses. Rejected for a hosted tool: the target would try to fetch the target's own loopback, which is what failed when we first ran the conformance suite remotely.*

**3. The TestAgent from `poppyseed/agent`, not a second implementation.**
It already does discovery, private_key_jwt, DPoP and MCP, and it is what the conformance suite and the landing-page demo use. The inspector shows real traffic from the same code, not a re-implementation that could disagree. It also exposes fault injection for later.

**4. Capture at the `fetch` boundary.**
One wrapper sees every request and response, including the ones the agent makes internally (token requests, polling). Steps cannot forget to report. Cost: polling is noisy, with one `authorization_pending` exchange per poll. That is accurate, and a debugger should show it.

**5. Redact on the server, by default.**
Tokens, assertions, DPoP proofs, cookies and device/refresh/access token fields are masked before events are streamed: headers by name, JSON and form fields by name, and any JWT-shaped string anywhere. The raw values never reach the browser. `INSPECTOR_REVEAL=1` turns it off for local debugging. *Alternative: redact in the UI. Rejected: the secrets would already be in the browser and in its network log.*

**6. The target is fixed by configuration, not typed in the UI.**
`TARGET_URL` only. A free-form URL would turn the backend into a proxy that can be pointed at internal addresses. If multi-target is wanted later, it needs an allow-list.

**7. One run at a time, one instance.**
Run state, agent keys and login sessions are in memory. A second concurrent run returns 409. A restart loses runs and signs everyone out. *Alternative: a shared store. Deferred: nothing here needs it yet, and it would add a database to a debugging tool.*

**8. The human steps wait for a real person.**
Device Sign-In can only be approved by someone in their own browser, and the spec forbids an agent approving for them. The run emits an `action.required` event with the link and code and polls. The agent never confirms an operation before the person has decided; an unanswered decision declines after 10 minutes, never approves by default. Links are shown only if their host is the issuer's or a protected resource's (spec 4.6).

**9. The inspector's own login is OIDC with PKCE, run by the server (Curity).**
The server is the OIDC client: authorization code flow, S256 PKCE, `state`, `nonce`, a verified ID token (issuer, audience, algorithm allow-list). The browser holds only an opaque HttpOnly cookie, so no tokens are in the browser. *Alternative: a browser-side OIDC client (SPA). Rejected: tokens in the browser, and nothing here needs them.*

**10. A valid Curity login is not enough: an allow-list is required.**
The server holds a live agent identity and can trigger real operations on the target. Any account at the identity provider could otherwise use it. Startup fails if OIDC is configured without `OIDC_ALLOWED_SUBS` or `OIDC_ALLOWED_EMAILS`. Subs are matched exactly; emails case-insensitively.

**11. A shared token remains as a fallback.**
`INSPECTOR_TOKEN` works for scripts and for the time before Curity is configured. Unsetting it makes Curity the only way in. Production refuses to start with neither.

**12. Fail closed on deployment.**
"Production" is `NODE_ENV=production`, an `https` public URL, or a Railway environment, so forgetting `NODE_ENV` cannot leave the API open.

**13. Defences around the login and the API.**
The login state is bound to the browser that started it by a short-lived cookie (login CSRF). A callback state is single-use. Cookies are HttpOnly, SameSite=Lax, Secure and `__Host-` prefixed on HTTPS. State-changing requests check `Origin`. The pending-login table evicts its oldest entry past a cap, so a flood cannot lock real logins out. The UI is served with a strict CSP. These are covered by `server/oidc.test.ts`; the login-CSRF test was checked to fail when the check is removed.

**14. The steps assume Poppyseed's own paths.**
Signed-in tool calls go to `/poppy/tools/<name>` (from `poppyseed/paths`), as the repo's demo journey does. It makes the inspector a Poppyseed debugger first. Reaching other implementations would mean reading the OpenAPI description instead (see next steps).

**15. Defaults are the Poppy Travel demo's, and a step is skipped when the target lacks the tool.**
`search_flights`, `my_trips`, `book_flight` are overridable by environment variable. A site with other tools sees those steps skipped, not failed.

## Deployment

Railway project `poppyseed`, three services built from the fork (`SecSimply/poppyseed`) with Railpack:

| Service | Purpose | Notes |
| --- | --- | --- |
| `poppyseed-site` | the demo site, production settings | `memoryStore()`: one instance, state resets on restart |
| `poppyseed-staging` | the same code with `POPPYSEED_ALLOW_LOOPBACK_AGENTS=1` | for running `poppyseed check` from inside the container; do not point anything real at it |
| `poppyseed-inspector` | this tool | targets `poppyseed-site`; Curity login, token fallback |

Build and start commands are set as `RAILPACK_BUILD_CMD` and `RAILPACK_START_CMD` variables: Railpack fails at detection on the monorepo root otherwise. Deploys so far have been `railway up` from a local clone, because linking the GitHub repo from the CLI returned "Unauthorized"; pushes do not redeploy until the repo is connected in the dashboard.

**State at the time of writing:** the code described here is committed and deployed with `railway up` from a local clone. The Curity login uses a confidential client (`client_secret_basic`) at a publicly trusted domain, with an email allow-list. A self-signed certificate on Curity's raw Railway TCP address would have broken login, because the inspector verifies TLS and that is not relaxed. `INSPECTOR_TOKEN` is still set; unset it to make Curity the only way in.

## What is tested, and what is not

Tested:
- The whole journey locally against the demo site, including approve and decline, via `scripts/e2e-local.ts`.
- The OIDC client against a mock provider that enforces PKCE, nonce, audience, single-use codes and the exact redirect URI (10 unit tests), and the login routes end to end with curl against the same mock.
- The phase 1 journey against the deployed production site over HTTPS.
- `pnpm verify` for the whole repo, and `pnpm audit` (clean).

Not tested:
- **Real Curity, as automated tests.** A login against the real provider and the UI in a browser were checked by hand and worked; nothing automated covers them.
- **The React UI in a browser.** It typechecks and builds; it has not been seen rendering, including the login screen and the action panel.
- **An operation that requires the person's own approval** (the demo only does this above $1,000).
- **Multiple simultaneous users** and long-lived streams behind Railway's proxy (a keep-alive comment is sent every 20 s for this).

## Known limitations

- Run state, agent keys and login sessions are in memory; a restart ends them.
- Anyone on the allow-list can see, cancel and decide any run: it is a single-tenant tool.
- Sign-out ends the inspector's session, not the Curity session.
- Request and response bodies are cut at 64 KB.
- Polling for device approval produces one exchange per poll.
- Requests the target makes to the agent's metadata URLs (`client.json`, JWKS) are not shown, which is a blind spot when debugging identity problems.

## Next steps

In rough order. The first group is what is needed before this is useful on the deployed service.

**Before using the Curity login**
1. Register the client in Curity (authorization code, PKCE required, redirect `<public URL>/auth/callback`, scopes `openid email`) and set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, the allow-list, and a secret if the client is confidential.
2. Look at the UI in a real browser and fix what is broken. This has not been done.
3. Redeploy `poppyseed-inspector`, check a real login, then unset `INSPECTOR_TOKEN`.
4. Connect the GitHub repo to the Railway services so pushes deploy.

**Debugging value**
5. **JWT decoder:** decode the client assertion, DPoP proof and access token claims, with checks for `htu`, `htm`, `iat`, `jti`, `aud`. This needs a reveal path for the redacted values (an explicit per-value reveal, not a global switch).
6. **Fault injection:** `TestAgent` can bend each step (replayed proof, wrong `aud`, expired assertion, missing scope). Add toggles and show how the company refuses.
7. **Error hints:** map OAuth and DPoP error codes to likely causes.
8. **Show inbound requests:** record the target's fetches of `client.json` and the JWKS.
9. **Run export and import** as JSON, and copy-as-curl for an exchange.

**Coverage**
10. **Direct Sign-In** (authorization code + PKCE bound to the Session Key, redirecting to `/agent/callback`), shown next to Device Sign-In. Mediated Sign-In is a transitional mechanism and lower priority.
11. **Conversations** with the Company Agent, including handoff, and the browser-session join.
12. **Operations that require the person's own approval**, tested against a site that triggers it.
13. **A sequence diagram** (agent, person's browser, company) alongside the step list.

**Robustness**
14. **Conformance panel:** run `poppyseed check` from the inspector. It needs a target that accepts loopback agents, so only staging, and the check runs inside the container.
15. Move run and session state to a store if more than one instance or restart-survival is ever wanted.
16. If targets beyond our own are wanted: an explicit allow-list, and discovery of tool paths from the OpenAPI description instead of Poppyseed's fixed paths.
