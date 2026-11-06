# Protea Bank

A fictional South African bank, headquartered in Paarl, that shows what a personal agent can do with the Personal Agent Protocol. It is a Poppyseed site, like Poppy Travel in `site/`, with a banking theme and a short list of services. Amounts are in South African rand (ZAR). Nothing here is real: no money, accounts or people. The directory and package keep the earlier name, `nova` and `nova-bank`, so the Railway services and their settings are unchanged.

**Status:** phase 7 of 8. The Inspector has steps for the excluded tasks, browsing, and a blocked run, and [DEMO.md](DEMO.md) is a script for showing all five capabilities. Rates, branches, accounts, balances, transactions, payments, a support chat, browsing, excluded tasks and blocking work, with Direct and Device Sign-In and separate scopes. The conformance profile and hardening come next. The plan is in the project history; each phase adds one capability.

| Service | Shows | Phase |
| --- | --- | --- |
| Rates and branches | A signed-out agent doing useful work | 1, done |
| Accounts and balances | Sign-in (Direct and Device) and scopes | 2, done |
| Transactions | A second scope, separate from balances | 2, done |
| Payments | A human approving a sensitive operation | 3, done |
| Support chat | A Company Agent, with handoff to staff | 4, done |
| Online banking pages | An agent's browser joining its Session | 5, done |
| Blocking (all of the above) | Excluded tasks, agent feedback, and blocking a specific agent | 6, done |

## Browsing

With `web: {}` an agent's browser can join its Session (`/poppy/browser-session`). `/account` and `/payments` then show what that Session may see, the same as its tools: balances need `accounts:read`, payments need `transactions:read`. A section it may not see names the missing scope. A banner says an agent is viewing, as whom and with which scopes. An agent's browser sees no connected-agents list and no sign-out, and while it carries a Session the site login in the same browser is ignored. `lib/viewer.ts` holds the rule.

`scripts/browse-local.ts` drives this against a running local Protea with a real test agent and prints what each Session sees.

## What the bank will not do for an agent, and who it refuses

- **Excluded tasks** (`lib/excluded.ts`): "Add a new payee", "Close an account" and "Send an international payment". The site serves them, each with where to do it instead, at `/poppy/excluded-tasks.json`. They are kept on every interface: there is no tool for them; the support chat declines and gives the alternative; and on the website `/payees` gives a customer's own browser a form to add a payee but gives an agent's browser none, and the action refuses a call that carries an agent's Session.
- **Feedback** (`lib/feedback.ts`): an agent that reports a task it could not do gets, when the bank already offers it, how to do it. Reports are kept for staff in `/staff` as text, newest 100, and are never given to a model.
- **Blocking** (`lib/blocklist.ts`): `clients.block` refuses an agent by its `client_id`. Set `BLOCKED_CLIENTS` to URLs separated by spaces or commas, or block and unblock at `/staff?key=…`. A blocked agent gets `invalid_client` at its next Session; one it already has runs until its token expires (an hour by default). The list is in memory, so a restart returns to the variable.

`scripts/block-local.ts` starts a local build and proves all three with real test agents.

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
OPERATIONS=[{"label":"Pay Boland Power R1 735,00","tool":"pay_payee","arguments":{"payee_id":"pye_thandi_energy","from_account_id":"acc_thandi_everyday","amount":"1735.00","reference":"October"}},
            {"label":"Pay Dwarsrivier Rentals R14 500,00 (needs your approval)","tool":"pay_payee","arguments":{"payee_id":"pye_thandi_rent","from_account_id":"acc_thandi_everyday","amount":"14500.00","reference":"November rent"}}]
STANDING_PERMISSION=1
```

The demo customer Thandi Nkosi has the saved payees `pye_thandi_rent`, `pye_thandi_energy` and `pye_thandi_friend` (list them with `list_payees`), and the accounts `acc_thandi_everyday` and `acc_thandi_saver`.

## Decisions

- **Direct and Device Sign-In only.** Mediated Sign-In has the agent type the customer's password. A bank should not demonstrate that, so it is off.
- **The support agent is scripted.** It reads and explains: rates and branches for anyone, balances and recent transactions once the customer has signed in, using the caller's own scopes. Asked for balances without a sign-in, it asks for the `accounts:read` scope and shows nothing. It never moves money in a chat: a payment is an operation the customer approves, and a chat message is never an approval. Asking for a person hands the conversation to staff. Switching it to Claude is a configuration change (an Anthropic API key).
- **Staff take handoffs at `/staff?key=…`.** The key is the `POPPY_STAFF_KEY` environment variable. Without it the page does not exist in production. Staff can take a conversation, reply as "Protea Bank support", and hand it back.
- **One Poppyseed instance and one set of bank data per process.** In a production build a page and an API route can be bundled separately, each with its own copy of a module. Without a single shared instance, a conversation started through the API was missing from the staff page, and a payment made through the API was missing from the payments page.
- **Two kinds of payment, by size.** A payment to a saved payee up to R5 000,00, or a transfer between the customer's own accounts up to R50 000,00, may be confirmed by an agent under a standing permission. Above those limits the operation sets `user_approval_required`, and the bank refuses a confirmation that claims a standing permission. Only one the person approved (`approved_by: user`) is accepted.
- **Proposing a payment reveals whether the account can cover it.** A token with only `payments:write` could therefore learn roughly what an account holds by proposing different amounts, without `accounts:read`. The scope's description says so, so the customer sees it when granting the scope. Nothing moves until a proposal is confirmed.
- **An agent can only pay saved payees.** There is no tool to add one. Adding a payee is a task the bank will not offer to agents (phase 6).
- **A payment moves money once.** The operation id is the idempotency key, and the funds are checked again when the payment is performed, since the balance may have changed since it was proposed.
- **Balances and transactions are separate scopes.** `list_accounts` needs `accounts:read` and `list_transactions` needs `transactions:read`. A transaction never carries a balance, so a token can be given one view without the other.
- **Another customer's account looks like no account.** Asking for it returns the same "No account" answer as an id that does not exist.
- **A demonstration sign-in.** The site's own login asks you to pick one of two fictional customers, with no password, like Poppy Travel. Anyone who reaches the deployed site can pick either. That is acceptable only because the data is fictional.
- **State is in memory.** One instance, and a restart resets everything.
