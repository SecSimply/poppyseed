# Protea Bank

A fictional South African bank, headquartered in Paarl, that shows what a personal agent can do with the Personal Agent Protocol. It is a Poppyseed site with a banking theme and a short list of services. Amounts are in South African rand (ZAR). Nothing here is real: no money, accounts or people. The directory and package keep the earlier name, `nova` and `nova-bank`, so the Railway services and their settings are unchanged.

**How it all fits together:** [ARCHITECTURE.html](ARCHITECTURE.html) shows the components, the sign-in and payment flows, the phone, where each piece runs and what is still open. Open it in a browser.

**Status:** phase 8 of 8, complete, with sign-in through Curity. The Inspector has steps for the excluded tasks, browsing, and a blocked run, and [DEMO.md](DEMO.md) is a script for showing all five capabilities. Rates, branches, accounts, balances, transactions, payments, a support chat, browsing, excluded tasks and blocking work, with Direct and Device Sign-In and separate scopes. The plan is in the project history; each phase adds one capability.

| Service | Shows | Phase |
| --- | --- | --- |
| Rates and branches | A signed-out agent doing useful work | 1, done |
| Accounts and balances | Sign-in (Direct and Device) and scopes | 2, done |
| Transactions | A second scope, separate from balances | 2, done |
| Payments | A human approving a sensitive operation | 3, done |
| Support chat | A Company Agent, with handoff to staff | 4, done |
| Online banking pages | An agent's browser joining its Session | 5, done |
| Blocking (all of the above) | Excluded tasks, agent feedback, and blocking a specific agent | 6, done |
| Inspector steps and a demo script | Browsing, excluded tasks and a blocked run, shown | 7, done |
| Conformance | `poppyseed check`: 94 pass, 0 fail, 14 skip by design | 8, done |

## Browsing

With `web: {}` an agent's browser can join its Session (`/poppy/browser-session`). `/account` and `/payments` then show what that Session may see, the same as its tools: balances need `accounts:read`, payments need `transactions:read`. A section it may not see names the missing scope. A banner says an agent is viewing, as whom and with which scopes. An agent's browser sees no connected-agents list and no sign-out, and while it carries a Session the site login in the same browser is ignored. `lib/viewer.ts` holds the rule.

`scripts/browse-local.ts` drives this against a running local Protea with a real test agent and prints what each Session sees.

## Signing in

Customers and staff sign in with Curity (OpenID Connect, authorization code with PKCE, a confidential client). The flow is the `oidc-login` package, which the Inspector uses too. The server holds the tokens only for the moment it exchanges the code: what the browser keeps is a sealed session cookie (`__Host-pb_session` on https), with the person's id, email and name, and nothing it could use at Curity.

- **Menu:** **Account** signs in a customer; **Staff** signs in staff, asking Curity for a fresh sign-in each time.
- **Who a Curity user is:** a login is linked to a customer by its Curity `sub`, in Postgres. A login with no link signs in and sees **no accounts**, and waits in `/staff` under *Customer logins*. Staff either link it to an existing customer, or press **Create customer and link**, which opens a new customer with an everyday account and a saver of sandbox money (R15 000 and R5 000) and links the login to it.
- **Email must be verified.** A login whose email Curity marks `email_verified: false` identifies nobody here: it maps to no customer and is never staff. Curity users are made by hand, so a login that carries no such claim is trusted. If Curity ever allows self-registration, make it send the claim.
- **`STAFF_TRUST_UNVERIFIED=1`** is a temporary switch on `nova-bank`: Curity does not yet send `email_verified`, so a staff email is trusted unverified. Customers are unaffected. Remove it once Curity verifies emails or self-registration is closed.
- **Staff:** `STAFF_EMAILS` lists the emails that may use the console, kept by hand. Empty, nobody signs in as staff. A customer's login never opens the console.
- **The emergency key:** `POPPY_STAFF_KEY` still opens `/staff?key=…` when Curity is down or no one is listed yet. The console says when someone came in that way.
- **What staff did** (took, replied, handed back, blocked, unblocked) is listed at the foot of the console, with who and how they got in. It is kept in memory.
- **Consent pages:** Device and Direct Sign-In for agents now need a real sign-in, so only the signed-in customer can approve an agent.
- **A deployed (https) site refuses to start** without `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. A local http site without them keeps a demonstration login: pick one of the two customers, no password. It cannot run on https.

**The Curity client** is `protea-bank`: code flow, PKCE S256, a secret, scopes `openid profile email`, with these redirect addresses registered (checked against Curity: both are accepted):

- `https://app.proteabank.co.za/auth/callback`
- `http://localhost:3000/auth/callback`, for `pnpm dev`

Its details live in one file, `nova/proteabankoidc.md`, which holds the secret and is git-ignored. Two scripts use it so the secret is never typed or printed:

- `node --experimental-strip-types --no-warnings scripts/oidc-env.ts --local` writes `nova/.env.development.local`, so `pnpm dev` signs in with the real Curity on `localhost:3000`. Only `next dev` reads that file, so the local test scripts are not affected.
- `node --experimental-strip-types --no-warnings scripts/oidc-env.ts --railway` sets `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_REDIRECT_URI` on the `nova-bank` service without deploying. Run it again after the secret is rotated.

`OIDC_REDIRECT_URI` is checked, not trusted: the site finishes sign-ins at `<its address>/auth/callback`, so a registered address that says anything else stops the site at start-up with a message that names both.

**Where Curity is reached:** `OIDC_ENTRY` (https) is the address the bank reads Curity's discovery from, `https://idp.proteabank.co.za/oauth/v2/oauth-anonymous`, while Curity's issuer is still `https://idp.fluffycloud.co.za/oauth/v2/oauth-anonymous`. The bank requires the issuer in the document to equal `OIDC_ISSUER`. The document is cached for an hour, so restart the service after a change in Curity. Do not use Curity's *Issuer Override*: it breaks every endpoint address.

**Other variables:** `STAFF_EMAILS`, `STAFF_TRUST_UNVERIFIED`, `OIDC_ENTRY`, and the existing `POPPYSEED_BASE_URL`, `POPPYSEED_SECRET` and `POPPY_STAFF_KEY`.

`scripts/login-local.ts` proves all of it against a stand-in provider (the Inspector's `scripts/mock-oidc.ts`): a stranger, a customer, a login that is not a customer, a staff member, and an attacker who forges a cookie, replays a callback, signs someone out from another site, or tries an open redirect.

## What the bank will not do for an agent, and who it refuses

- **Excluded tasks** (`lib/excluded.ts`): "Add a new payee", "Close an account" and "Send an international payment". The site serves them, each with where to do it instead, at `/poppy/excluded-tasks.json`. They are kept on every interface: there is no tool for them; the support chat declines and gives the alternative; and on the website `/payees` gives a customer's own browser a form to add a payee but gives an agent's browser none, and the action refuses a call that carries an agent's Session.
- **Feedback** (`lib/feedback.ts`): an agent that reports a task it could not do gets, when the bank already offers it, how to do it. Reports are kept for staff in `/staff` as text, newest 100, and are never given to a model.
- **Blocking** (`lib/blocklist.ts`): `clients.block` refuses an agent by its `client_id`. Set `BLOCKED_CLIENTS` to URLs separated by spaces or commas, or block and unblock at `/staff?key=…`. A blocked agent gets `invalid_client` at its next Session; one it already has runs until its token expires (an hour by default). The list is in memory, so a restart returns to the variable.

`scripts/block-local.ts` starts a local build and proves all three with real test agents.

## Conformance

`pnpm --filter nova-bank check` builds Protea Bank, starts it with the test hooks on, and runs `poppyseed check` against it: **94 checks pass, none fail, 14 skip**. Every skip is something Protea Bank does not offer, and each is listed with its reason in `scripts/check-local.ts`; the run fails if anything else starts to skip, so a new gap cannot hide.

- `lib/conformance.ts` is the profile (which tools to call, which test people to use) and the company powers the suite needs: sign a test person in, end a Session, act as staff, read what `perform` was given.
- They are served at `/test-hooks` **only when `POPPYSEED_TEST_HOOKS=1`**, which is set for the check run and nowhere else. The production service has no such variable, and `lib/conformance.test.ts` proves the route answers 404 without it. With the flag on, device codes poll every second and last ten, so the suite does not wait on real timings.
- `/account/summary` is a plain-text account summary for browsing agents. It answers 200 with `accounts:read` (or for the customer in their own browser), 401 for nobody, and 403 naming the scope otherwise: the status the suite needs, and the one an agent can act on.

What the skips mean, in short: Mediated Sign-In is off on purpose; any agent may start a Session (a blocklist refuses particular ones); the support assistant reads and explains but never changes anything or proposes an operation; payments finish at once and are confirmed by the agent or the person in the Inspector, not on the website.

## Security notes

This is a demonstration, and some of it is deliberately not a real bank's:

- **The demonstration login exists only on a local http site.** Deployed (https), there is no way in but Curity, and a deployed site refuses to start without it. Any Curity user can sign in; what they see is decided by the customer link staff make in `/staff`, and `STAFF_EMAILS`, which is edited by hand.
- **The emergency staff key travels in the address and in each form.** `/staff?key=…` is checked in constant time, in the page and again in every action, but the key can end up in browser history. It exists for when Curity is down; staff use the Staff menu.
- **The test hooks sign anyone in.** They exist only behind `POPPYSEED_TEST_HOOKS=1`. Never set it on a service with real customers.
- **Everything the site writes is escaped** (React's defaults; nothing uses `dangerouslySetInnerHTML`). Reports from agents, payee names and client ids are shown as text.
- **Customers, accounts, transactions and payees are in Postgres** (`DATABASE_URL`, required when deployed), created on first use and seeded with the two demonstration customers once. Without `DATABASE_URL` (local development, tests) they are in memory. The blocklist, reports and Poppy's own state are still in memory and reset on a restart.

## Run

```sh
pnpm --filter nova-bank dev    # http://localhost:3000
```

Set `POPPYSEED_BASE_URL` to the address you serve it from (default `http://localhost:3000`). In production `POPPYSEED_BASE_URL` and `POPPYSEED_SECRET` (32 or more characters) are required.

To watch an agent use it, run the Inspector with `TARGET_URL` pointing here, and set `PUBLIC_TOOL=get_rates` so its "call a public tool" step uses a Protea tool.

To run the Inspector's signed-in steps against Protea, give it Protea's tool names. Set these on the Inspector:

```
TARGET_URL=<the site's address>
PUBLIC_TOOL=get_rates          PUBLIC_TOOL_ARGS={"product":"savings"}
SIGNIN_SCOPES=accounts:read transactions:read
SCOPED_TOOL=list_accounts
```

To show browsing, set `BROWSE_PATHS=/account /payments /payees /staff` (the last is there to show an agent's browser getting a 404). The excluded-tasks and blocked-agent steps need no settings.

To try the chat, set `CHAT_QUESTION` (what the anonymous chat step asks, for example `What are your savings rates?`) and `CHAT_ACCOUNT_QUESTION` (asked after sign-in, default `What are my balances?`) on the Inspector.

Payments need `payments:write` too, and the Inspector's operation steps need to know what to propose. Give it a list to choose between, and a standing permission so it can show the difference:

```
SIGNIN_SCOPES=accounts:read payments:write
OPERATIONS=[{"label":"Pay Boland Power R350,00","tool":"pay_payee","arguments":{"payee_id":"pye_thandi_energy","from_account_id":"acc_thandi_everyday","amount":"350.00","reference":"October"}},
            {"label":"Pay Dwarsrivier Rentals R14 500,00 (needs your approval)","tool":"pay_payee","arguments":{"payee_id":"pye_thandi_rent","from_account_id":"acc_thandi_everyday","amount":"14500.00","reference":"November rent"}}]
STANDING_PERMISSION=1
```

The demo customer Thandi Nkosi has the saved payees `pye_thandi_rent`, `pye_thandi_energy` and `pye_thandi_friend` (list them with `list_payees`), and the accounts `acc_thandi_everyday` and `acc_thandi_saver`.

## Decisions

- **Direct and Device Sign-In only.** Mediated Sign-In has the agent type the customer's password. A bank should not demonstrate that, so it is off.
- **The support agent is scripted.** It reads and explains: rates and branches for anyone, balances and recent transactions once the customer has signed in, using the caller's own scopes. Asked for balances without a sign-in, it asks for the `accounts:read` scope and shows nothing. It never moves money in a chat: a payment is an operation the customer approves, and a chat message is never an approval. Asking for a person hands the conversation to staff. Switching it to Claude is a configuration change (an Anthropic API key).
- **Staff take handoffs at `/staff?key=…`.** The key is the `POPPY_STAFF_KEY` environment variable. Without it the page does not exist in production. Staff can take a conversation, reply as "Protea Bank support", and hand it back.
- **One Poppyseed instance and one set of bank data per process.** In a production build a page and an API route can be bundled separately, each with its own copy of a module. Without a single shared instance, a conversation started through the API was missing from the staff page, and a payment made through the API was missing from the payments page.
- **Two kinds of payment, by size.** A payment to a saved payee up to R500,00, or a transfer between the customer's own accounts up to R5 000,00, may be confirmed by an agent under a standing permission. Above those limits the operation sets `user_approval_required`, and the bank refuses a confirmation that claims a standing permission. Only one the person approved (`approved_by: user`) is accepted.
- **Proposing a payment reveals whether the account can cover it.** A token with only `payments:write` could therefore learn roughly what an account holds by proposing different amounts, without `accounts:read`. The scope's description says so, so the customer sees it when granting the scope. Nothing moves until a proposal is confirmed.
- **Two bank-only tools serve the bridge.** `who_am_i` tells an agent which customer it is signed in as. `end_all_sign_ins` ends every sign-in that agent has for the customer; the bridge calls it on sign-out and does not offer it to Claude.
- **An agent can only pay saved payees.** There is no tool to add one. Adding a payee is a task the bank will not offer to agents (phase 6).
- **A payment moves money once.** The operation id is the idempotency key, and the funds are checked again when the payment is performed, since the balance may have changed since it was proposed.
- **Balances and transactions are separate scopes.** `list_accounts` needs `accounts:read` and `list_transactions` needs `transactions:read`. A transaction never carries a balance, so a token can be given one view without the other.
- **Another customer's account looks like no account.** Asking for it returns the same "No account" answer as an id that does not exist.
- **A demonstration sign-in.** The site's own login asks you to pick one of two fictional customers, with no password. Anyone who reaches the deployed site can pick either. That is acceptable only because the data is fictional.
- **Customers are in Postgres, Poppy's state is not.** Connected agents, operations and conversations are in memory, one instance, and a restart ends them.

## The Protea app: approving agent payments on a phone

A customer can enroll a phone (Account → Add my phone, then scan the QR code in the app). Once one is enrolled, **every** payment or transfer an agent asks for waits for that phone: the app shows it, the customer confirms with a fingerprint, and the phone signs the approval. The agent's own confirmation is refused, even when it claims the customer's approval, and the bank's approval page no longer approves for that customer. The wire format is in [AUTHENTICATOR.md](AUTHENTICATOR.md). The Android app is `../protea-app` (see its README for building and installing it by hand); `scripts/fake-phone.ts` is a phone on the command line.

- A customer has one device. Replacing it is a staff action: `/staff` → *Customers' phones* (Curity staff sign-in; the emergency key can only look).
- Enrolling needs the customer's signed-in browser, and the customer comparing a code on the phone and the website. It does not ask for a new Curity sign-in.
- A proposal made before a phone was enrolled stays an ordinary proposal until it lapses (15 minutes).
- Postgres is required when deployed, as for customers and accounts: the tables `nova_devices`, `nova_device_enrollments`, `nova_device_nonces` and `nova_approvals` are created on first use.

