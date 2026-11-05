# Poppy Inspector

A protocol debugger for developers. It runs a real Personal Agent (`poppyseed/agent`) against one Poppyseed site and shows every request the agent makes: method, URL, headers, bodies, status, timing, grouped by protocol step.

**[ARCHITECTURE.md](ARCHITECTURE.md)** records how it is built, the decisions behind it (and what was rejected), what is and isn't tested, deployment, and the next steps.

## Status

| | |
| --- | --- |
| Built and tested locally | The anonymous journey, device sign-in, scoped call, operation propose/approve/decline, sign-out; sign in with Curity (OIDC + PKCE) against a mock provider. |
| Deployed on Railway | Yes: the full journey and the Curity login. `INSPECTOR_TOKEN` is still set as a fallback. |
| Verified by hand | Curity login and the UI in a browser, reported working by the owner. Not recorded as automated tests. |

**Next:** register the client in Curity and redeploy; look at the UI in a browser; then the JWT decoder and fault injection. The full list is in [ARCHITECTURE.md](ARCHITECTURE.md#next-steps).

Steps:

1. **Discover**, **start a Session**, **list tools over MCP**, **call a public tool**. Anonymous: "Run journey".
2. With "Run with sign-in and operations", which needs a person:
   - **Sign a person in** with Device Sign-In. The UI shows the company's link and code; you approve in your own browser. The link is shown only if its host is the issuer's or a protected resource's (spec 4.6).
   - **Call a scoped tool** with the signed-in Session.
   - **Propose an operation** (a booking). The UI shows its summary and terms.
   - **The person decides**: Approve or Decline in the UI, or on the company's page when the operation requires the person's own approval. Nothing is confirmed before that, and an unanswered run declines after 10 minutes.
   - **Sign out**: revokes the Account Token, whether or not the journey finished (spec 4.9).

A failing step stops the run and shows the company's error.

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
| `PUBLIC_TOOL`, `PUBLIC_TOOL_ARGS` | The tool for the "call a public tool" step (JSON arguments). Defaults to the demo's `search_flights`; skipped if the target has no such tool. |
| `SIGNIN_SCOPES` | Scopes to request at sign-in. Defaults to the demo's, else every scope the site offers. |
| `SCOPED_TOOL`, `SCOPED_TOOL_ARGS` | The tool for "call a scoped tool". Default `my_trips`. |
| `OPERATION_TOOL`, `OPERATION_ARGS` | The tool that proposes an operation. Default `book_flight`, with the first offer from the public tool's results. |

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

To try the sign-in locally without Curity, run `scripts/mock-oidc.ts` (it signs in anyone as `dev@example.com`, so loopback only; see its header). `scripts/e2e-local.ts` drives the whole journey against the demo site, playing the demo's test traveler as the person who approves. `pnpm --filter poppyseed-inspector test` covers the OIDC flow against a mock provider that enforces PKCE.

## Not yet (later phases)

Direct Sign-In, Mediated Sign-In, conversations, a JWT decoder, fault injection, run export/import, and requests the target makes to the agent's metadata URLs.
