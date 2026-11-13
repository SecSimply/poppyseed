---
name: security-check
description: Review a change to Poppyseed for security gaps before it is pushed. Use on every change to packages/core/src (outside conformance/ and agent/), site server code, fixtures/next-app routes, workflows or dependencies, and whenever someone asks for a security review. Walks the diff against the invariants below, and turns each real gap into a conformance check and a mutant.
---

# Security check

Run it on every change before you push, and again when a review bot or a person raises a security finding. The conformance suite proves the protocol; this check looks for what the suite doesn't cover yet.

## 1. Scope the diff

```sh
git fetch origin master
git diff origin/master... --stat
git diff origin/master... -- packages/core/src site fixtures/next-app .github package.json pnpm-lock.yaml
```

The test agent (`src/agent/`), the checks (`src/conformance/`) and `fixtures/reference` are test code. Review them only where they decide what a check accepts.

## 2. Hold the change to these invariants

Each line is a rule the code must keep. For each one the diff touches, find the code that enforces it, and trace a request from outside to it.

**Tokens and Sessions**
- Session Tokens are sealed and opaque (`tokens.ts`). Each sealer purpose is bound in, so one kind of token never opens as another.
- Tokens never appear in URLs or logs. `guard.ts` refuses `access_token` in a query.
- Every API request reloads the Session (`loadSession` with the token's `cid` and `uid`). Nothing trusts a stored copy of a caller.
- A signed-in token works only while the sign-in it was issued under lasts (`claims.sign` equals `signedIn.tokenHash`). The scopes are the overlap of the token's scopes and the live sign-in's scopes.
- Anything that acts later for a caller (conversations, operations, staff, Company Agent turns) uses the caller's Session as it is now, never a copy saved earlier. `ConversationStore.current` is the pattern.
- An MCP token (`res` is the MCP URL) works only at the MCP server, and other tokens only elsewhere.

**DPoP and grants**
- `verifyDpop` checks: one proof, `typ`, ES256/RS256 only, a public `jwk`, `htm`, `htu` without query, `iat` within the window, `jti` used once, and the nonce or `ath` and key binding when given.
- Authorization codes: used once; `client_id`, `redirect_uri`, PKCE S256 and `dpop_jkt` all match.
- Redirect URIs (`clients.ts`): each one in client metadata uses the `client_id`'s scheme and host, or is an `http` loopback IP literal (RFC 8252 §7.3). Only a loopback URI may differ from its entry, and only in the port (`isRegisteredRedirect`). Until `client_id` and `redirect_uri` check out, errors go on a page, never to the redirect.
- Session assertions: an optional `agent_id` is a short string, and a Session keeps the Agent ID it started with. Renewing with another one, or with none, gets `invalid_grant`.
- Device codes are bound to the first poll's key and client. Other keys get `invalid_grant` and change nothing.
- Refresh tokens: the same client; scope can only narrow; no switch to another account.
- Client assertions: `aud` is the issuer, lifetime is at most 300 s, `jti` is used once, `sub` is `client_id`, and no embedded key.

**Who owns what**
- Conversations, operations, sign-ins and device records belong to one client and User. Records that used an account also belong to that account. Another account gets not-found, and a signed-out caller gets `insufficient_scope`.
- A state change that must happen once uses `claimOnce` or an atomic `store.update`, never a get followed by a put.
- A Personal Agent can't pass itself off as a Company writer: from its messages the Company keeps only `author.type`. A staff `author.image` must be HTTPS.

**Browsers and HTML**
- Every value written into HTML goes through `esc()`. Links and logos must be HTTPS.
- Cookies are `Secure; HttpOnly`, with the `__Host-` prefix unless `cookieDomain` is set. The join cookie is `SameSite=Strict`. Forms that change state check CSRF and a sealed state.
- Loading a page changes no Session.

**Fetching and input**
- Outbound fetches of agent-supplied URLs go through `safe-fetch.ts` (HTTPS only, plus the connect-time address check).
- Request bodies are parsed with `strictJson` and validated at the boundary. Lengths have limits.
- Errors leave through `PoppyError`; a tool's internal error is reported as "tool failed" and never echoed.
- A value from a browser or an agent that goes into a path or query of a request to another service (the bank site's calls to the device auth service carry its admin key) is first checked to be an id of plain characters (`ID` in `nova/lib/phone-signin.ts`). `encodeURIComponent` leaves `.` alone, so `..` would change the address the key is sent to.
- A secret the server uses to call another service (`DEVICE_AUTH_ADMIN_KEY`) is read only by server modules, never imported by a `"use client"` file, never rendered, never in a URL, and never part of an error message.

**Supply chain**
- `pnpm audit` reports nothing. Overrides stay in `package.json` until the dependents are fixed.
- Workflows don't put untrusted input (PR titles, branch names, comment bodies) into `run:` lines.

## 3. Act on what you find

For each gap, write the request that exploits it. If you can't write one, it is a note, not a finding.

A real gap is a protocol bug, so fix it the repo's way (AGENTS.md, "Changing protocol behaviour"):
1. A black-box check in `packages/core/src/conformance/checks/` that fails on the gap. If the outside view can't see it, add a hook to `Hooks` (`agent/types.ts`), `http-hooks.ts` and the reference company (`staffCallTool` is an example).
2. A mutant in `scripts/mutants.data.ts` that reopens the gap, caught by that check.
3. The fix, then `pnpm verify` and `pnpm mutants <name>`.

A rule above that is new or changed belongs in this file in the same commit.

## 4. Report

List each invariant the diff touched, with the code that holds it (`file:line`), plus each finding and its fix commit. Put "no findings" in the PR when that is the result.
