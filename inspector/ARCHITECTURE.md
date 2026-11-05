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
- **`server/hints.ts`**, **`server/jwt.ts`**: what the capture adds to an exchange. Hints are likely causes for a refusal; the decoder reads the JWTs in a request and checks them.
- **`server/faults.ts`**: the 18 deliberately broken requests, and the run that sends them.
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
| chat | a question to the company's agent, answered from the events (skipped if the company has none) | no |
| signin | Device Sign-In: link and code shown, the inspector polls | yes: approves on the company's page |
| account | a scoped tool over the HTTP API (default `my_trips`) | no |
| chat-account | a question about the account, in a new conversation with the signed-in token | no |
| handoff | asks for a person and leaves the conversation open for staff | no |
| propose | an action tool returns an operation (default `book_flight`) | no |
| approve | the person approves or declines; the agent confirms or cancels | yes: in the UI. With `STANDING_PERMISSION=1`, not for an operation the company lets an agent do |
| signout | revokes the Account Token | no |

The first five run with "Run journey". All eleven run with "Run with sign-in and operations".

**Fault tests** are a separate run: discover, a valid control request, then the broken request or requests. A fault passes when the company refuses it (400, 401 or 403). A request it must refuse but accepts fails the run, and so does a 5xx, which is the company failing and not refusing.

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
Device Sign-In can only be approved by someone in their own browser, and the spec forbids an agent approving for them. The run emits an `action.required` event with the link and code and polls. The agent never confirms an operation before the person has decided; an unanswered decision declines after 10 minutes, never approves by default. The person decides in the inspector, as the spec has it: the agent gets the User's approval through its own interface and confirms as `user`. An operation the company marks `user_approval_required` is always decided this way. A standing permission, off by default, may cover only operations the company does not mark, so the difference between the two is visible. Links are shown only if their host is the issuer's or a protected resource's (spec 4.6).

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

**16. The token decoder sends claims, never tokens.**
The decoder runs on the server and the browser receives each token's header, its claims and the checks, never the signature. An assertion without its signature cannot be replayed, so reading one exposes no credential. Private members of a key in a header are masked too (a deliberately leaked key in a fault test would otherwise be relayed). This replaces the earlier plan for a per-value reveal of redacted tokens: nothing needs revealing. *Alternative: send the token and decode in the browser. Rejected: the credential would be in the browser, and the global reveal switch was already the only thing standing between it and the screen.*

**17. Checks state the rule they enforce, and which of them are Poppyseed's own.**
Assertion rules (audience is the issuer as one string, lifetime at most 300 s, no embedded key, `jti` of 128 bits) come from spec 4.2 and the library's verification code; the DPoP checks are RFC 9449. The ±90 s `iat` window is Poppyseed's own choice and is labelled so. Until discovery has found the issuer, `aud` is compared with the request's origin and reported as information, not failure. The decoder checks what the agent *sent*; it cannot say whether a signature verified.

**18. A fault test starts with a control request, and a refusal must be a 4xx.**
Without a control, a refusal could be caused by a broken setup and the fault would look like it worked. A 5xx fails the run: the company crashed, it did not refuse. Replays send the same request twice and expect it to be accepted once, then refused. Faults reuse `TestAgent`'s own options for bending a request, so there is no second implementation to drift.

**19. The page reads a run by short polling, not a stream.**
The page asks `/api/runs/:id/poll?from=N` for the events after the last one it has. Each answer is a whole response, held for up to 20 seconds when there is nothing new, and it says where to resume. A proxy that holds back a stream, or a dropped connection, cannot hide an event or lose one: the next request carries on from the same place. The first version used server-sent events, and on Railway a run that waited for a person (the "Approve this yourself" panel) showed nothing. The stream route remains for the local scripts. *Alternative: keep SSE and reconnect. Rejected: it relies on the proxy flushing, which is the thing that failed.*

**20. A finished run shows the step that matters, not sign-out.**
Sign-out ends every longer run, so showing the latest step hid the payment result. The page shows the step the person chose, else a failing one, else the latest step other than sign-out.

**21. The chat steps read answers from events, and leave a handoff open.**
A company's agent may answer a moment after accepting a message, so the step reads the events again from the cursor, a few times, and says so when nothing came rather than reporting silence as success. A request for a scope is shown as the company's answer, with the scope. The handoff step does not close the conversation: closing it would take it out of the staff queue before anyone could see it. The cost is that every longer run leaves one waiting conversation at the target.

**22. Hints are a static table keyed by error code.**
Advice is selected by the error code and narrowed by patterns in the description, and the description is never echoed into the page. A code the table does not know gets no hint rather than a guess.

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
- **Faults against production.** All 18 were run against the demo site locally (every one refused, controls accepted) and are covered by unit tests with a stand-in agent, but have not been run against the deployed site.
- **Hints, decoder and fault picker in a real browser.** They are covered by component tests only.
- **Real Curity, as automated tests.** A login against the real provider and the UI in a browser were checked by hand and worked; nothing automated covers them.
- **The React UI in a browser.** It typechecks and builds; it has not been seen rendering, including the login screen and the action panel.
- **An operation that requires the person's own approval** (the demo only does this above $1,000).
- **Multiple simultaneous users.**

## Known limitations

- Run state, agent keys and login sessions are in memory; a restart ends them.
- Anyone on the allow-list can see, cancel and decide any run: it is a single-tenant tool.
- Sign-out ends the inspector's session, not the Curity session.
- Request and response bodies are cut at 64 KB.
- Polling for device approval produces one exchange per poll.
- Fault tests and checks cover the token endpoint and one MCP call; they say nothing about a site's other endpoints.
- Hints are static advice and can be wrong for a site that words its errors differently.
- Requests the target makes to the agent's metadata URLs (`client.json`, JWKS) are not shown, which is a blind spot when debugging identity problems.

## Next steps

In rough order. The first group is what is needed before this is useful on the deployed service.

**Before using the Curity login**
1. Register the client in Curity (authorization code, PKCE required, redirect `<public URL>/auth/callback`, scopes `openid email`) and set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, the allow-list, and a secret if the client is confidential.
2. Look at the UI in a real browser and fix what is broken. This has not been done.
3. Redeploy `poppyseed-inspector`, check a real login, then unset `INSPECTOR_TOKEN`.
4. Connect the GitHub repo to the Railway services so pushes deploy.

**Debugging value**
5. ~~**Error hints**~~ Done (decision 22).
6. ~~**JWT decoder**~~ Done, without needing a reveal path (decision 16).
7. ~~**Fault injection**~~ Done: 18 faults (decision 18). Still to add: faults at the MCP and tool endpoints, such as a missing scope, a `Bearer` scheme and a token for another service.
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
