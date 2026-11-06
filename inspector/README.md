# Poppy Inspector

A protocol debugger for developers. It runs a real Personal Agent (`poppyseed/agent`) against one Poppyseed site and shows every request the agent makes: method, URL, headers, bodies, status, timing, grouped by protocol step.

**[ARCHITECTURE.md](ARCHITECTURE.md)** records how it is built, the decisions behind it (and what was rejected), what is and isn't tested, deployment, and the next steps.

## Status

| | |
| --- | --- |
| Built and tested locally | The anonymous journey, device sign-in, scoped call, operation propose/approve/decline, sign-out; sign in with Curity (OIDC + PKCE) against a mock provider; error hints, the JWT decoder and 18 fault tests against the demo site. |
| Deployed on Railway | The full journey and the Curity login; `INSPECTOR_TOKEN` has been removed. The hints, JWT decoder and fault tests are not deployed yet. |
| Verified by hand | Curity login and the UI in a browser, reported working by the owner. Not recorded as automated tests. |

**Next:** deploy the debugging features, then show the target's requests for the agent's metadata, export runs, and Direct Sign-In. The full list is in [ARCHITECTURE.md](ARCHITECTURE.md#next-steps).

Steps:

1. **Discover**, **read the tasks the company won't offer** (the excluded-tasks document, no token needed), **start a Session**, **list tools over MCP**, **call a public tool**, **ask the company's agent** a question, and **ask it for a task it won't offer** (it should decline and say where to do it). The last three of those are skipped when the company has no conversations or no excluded tasks. Anonymous: "Run journey".
2. With "Run with sign-in and operations", which needs a person:
   - **Sign a person in** with Device Sign-In. The UI shows the company's link and code; you approve in your own browser. The link is shown only if its host is the issuer's or a protected resource's (spec 4.6).
   - **Call a scoped tool** with the signed-in Session.
   - **Browse the site as the agent**: the agent's browser joins its Session (spec 5) and loads the pages in `BROWSE_PATHS`; the step shows each page's status and text, so you see what that Session is shown. Skipped when the company has no browser-session endpoint.
   - **Ask the company's agent about your account** in a new conversation, now signed in, then **ask for a person**: the conversation is left open in the company's queue for staff to take.
   - **Propose an operation** (a booking). The UI shows its summary and terms.
   - **The person decides**: Approve or Decline in the UI. Nothing is confirmed before that, and an unanswered run declines after 10 minutes. When the company requires the person's own approval, the agent confirms as the user and never as a standing permission. With `STANDING_PERMISSION=1`, an operation that does not require it is confirmed under the permission without asking.
   - **Sign out**: revokes the Account Token, whether or not the journey finished (spec 4.9).

A failing step stops the run and shows the company's error. A company that has chosen to refuse the agent (`clients.block`, or `clients.allow` without it) fails the Session step with `invalid_client`, and the hint says it is the company's decision rather than a fault in the agent's keys.

### Debugging aids

- **Likely causes.** When the target refuses a request, the exchange shows what to check, keyed on the OAuth or DPoP error code and narrowed by its description (a wrong `htu`, a replayed `jti`, an expired token).
- **Token decoder.** Every DPoP proof and client or session assertion the agent sends is decoded beside its request, with its header and claims, and checked against the rules the company applies: `typ`, `htm`, `htu`, `iat`, `jti`, `ath`; `aud`, lifetime, no embedded key. Failing checks open by themselves. Only header and claims are sent to the browser: the signature, which makes a token usable, stays on the server. Access tokens are opaque, so they are not decoded.
- **Fault tests.** "Fault test" sends one deliberately broken request, such as an expired assertion, a proof for another URL, a replayed `jti` or a token used with another key, and passes when the target refuses it. A valid control request goes first, so a refusal is the fault's doing. A fault the target *accepts* fails the run. There are 18; the list is in `server/faults.ts`. They send invalid requests to `TARGET_URL`, so point the inspector at your own site.

```
React UI  ⇄ SSE ⇄  backend (TestAgent; serves /agent/client.json and /agent/jwks.json)  ⇄  TARGET_URL
```

The agent's identity is hosted by this server on its own HTTPS origin, so the target fetches it like any agent's. Nothing needs loosening on the target.

## Configuration

| Variable | |
| --- | --- |
| `TARGET_URL` | The Poppyseed site to inspect. Required in production. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | Sign in with Curity (below). |
| `OIDC_CLIENT_SECRET` | Only for a confidential client. Leave unset for a public client: PKCE protects the code. |
| `OIDC_ALLOWED_SUBS`, `OIDC_ALLOWED_EMAILS` | Comma-separated. **Required with OIDC**: a valid Curity login alone is not enough, since this server holds a live agent identity. Subs match exactly; emails ignore case. |
| `OIDC_SCOPES` | Default `openid email`. |
| `INSPECTOR_TOKEN` | 16+ characters. A shared token for scripts, and a fallback while Curity is not set up. Unset it to make Curity the only way in. Production needs OIDC or this. |
| `INSPECTOR_PUBLIC_URL` | This server's public origin (default: `RAILWAY_PUBLIC_DOMAIN`, else localhost). It becomes the agent's `client_id`. |
| `INSPECTOR_REVEAL=1` | Show tokens and assertions unredacted. Off by default. |
| `PUBLIC_TOOL`, `PUBLIC_TOOL_ARGS` | The tool for the "call a public tool" step (JSON arguments). Default `get_rates` with `{"product":"savings"}`; skipped if the target has no such tool. |
| `SIGNIN_SCOPES` | Scopes to request at sign-in. Defaults to the demo's, else every scope the site offers. |
| `SCOPED_TOOL`, `SCOPED_TOOL_ARGS` | The tool for "call a scoped tool". Default `list_accounts`. |
| `OPERATION_TOOL`, `OPERATION_ARGS` | The tool that proposes an operation. Default a small payment to one of Protea Bank's saved payees. `OPERATIONS` offers several to choose between. |
| `BROWSE_PATHS` | Pages the browse step loads, space- or comma-separated, each starting with `/` (default `/`). |
| `CHAT_QUESTION`, `CHAT_ACCOUNT_QUESTION` | What the chat steps say to the company's agent: signed out (default `What can you help me with?`) and signed in (default `What are my balances?`). |
| `OPERATIONS` | A JSON list of `{label, tool, arguments}` operations the longer run can propose. The person picks one before running. When set, it replaces `OPERATION_TOOL` and `OPERATION_ARGS`. |
| `STANDING_PERMISSION=1` | Let the agent confirm, without asking, an operation the company does not require the person's own approval for. It is confirmed as `standing_permission`. One the company requires the person's own approval for is never confirmed this way. Off by default. |

The sign-in and operation steps call the site's tools at `/poppy/tools/<name>`, as Poppyseed serves them.

## Sign in with Curity

The inspector runs OpenID Connect itself, as a backend for the browser: authorization code flow with PKCE (S256), state, nonce and a verified ID token. The browser only holds an opaque, HttpOnly session cookie. Register a client in Curity with:

- the authorization code flow, with PKCE required (a public client, or a confidential one if you set `OIDC_CLIENT_SECRET`);
- redirect URI `<INSPECTOR_PUBLIC_URL>/auth/callback`;
- scopes `openid` and `email`;
- `OIDC_ISSUER` set to the issuer exactly as Curity's discovery document reports it (`<issuer>/.well-known/openid-configuration`).

Then set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and at least one of `OIDC_ALLOWED_SUBS` and `OIDC_ALLOWED_EMAILS`. Sign-out ends the inspector's session, not your Curity session.

## Run

```sh
pnpm --filter poppyseed-inspector dev            # API on :3001 (TARGET_URL defaults to http://localhost:3000)
pnpm --filter poppyseed-inspector dev:ui      # UI with hot reload, proxying /api
pnpm --filter poppyseed-inspector build && pnpm --filter poppyseed-inspector start   # one server
```

A local run needs a target that accepts loopback agents (a Poppyseed site in development). Run one instance only: keys, runs and login sessions live in the process, so a restart signs everyone out.

To try the sign-in locally without Curity, run `scripts/mock-oidc.ts` (it signs in anyone as `dev@example.com`, so loopback only; see its header). `scripts/ui-local.ts` drives the real page in headless Chrome (it needs Chrome) through a longer run against a local Nova Bank, playing the customer who approves the sign-in, and prints what the page shows. `scripts/faults-local.ts` runs every fault against a running inspector and exits non-zero if the target accepts one. `scripts/e2e-local.ts` drives the whole journey against the demo site, playing the demo's test traveler as the person who approves. `pnpm --filter poppyseed-inspector test` covers the OIDC flow against a mock provider that enforces PKCE.

## Not yet (later phases)

Direct Sign-In, Mediated Sign-In, conversations, run export/import, and requests the target makes to the agent's metadata URLs.
