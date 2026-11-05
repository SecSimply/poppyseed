# Nova Bank

A fictional bank that shows what a personal agent can do with the Personal Agent Protocol. It is a Poppyseed site, like Poppy Travel in `site/`, with a banking theme and a short list of services. Nothing here is real: no money, accounts or people.

**Status:** phase 3 of 8. Rates, branches, accounts, balances, transactions and payments work, with Direct and Device Sign-In and separate scopes. Support chat, browsing and blocking come next. The plan is in the project history; each phase adds one capability.

| Service | Shows | Phase |
| --- | --- | --- |
| Rates and branches | A signed-out agent doing useful work | 1, done |
| Accounts and balances | Sign-in (Direct and Device) and scopes | 2, done |
| Transactions | A second scope, separate from balances | 2, done |
| Payments | A human approving a sensitive operation | 3, done |
| Support chat | A Company Agent, with handoff to staff | 4 |
| Online banking pages | An agent's browser joining its Session | 5 |
| Blocking (all of the above) | Excluded tasks, and blocking a specific agent | 6 |

## Run

```sh
pnpm --filter nova-bank dev    # http://localhost:3000
```

Set `POPPYSEED_BASE_URL` to the address you serve it from (default `http://localhost:3000`). In production `POPPYSEED_BASE_URL` and `POPPYSEED_SECRET` (32 or more characters) are required.

To watch an agent use it, run the Inspector with `TARGET_URL` pointing here, and set `PUBLIC_TOOL=get_rates` so its "call a public tool" step uses a Nova tool.

To run the Inspector's signed-in steps against Nova, give it Nova's tool names. Set these on the Inspector:

```
TARGET_URL=<nova's address>
PUBLIC_TOOL=get_rates          PUBLIC_TOOL_ARGS={"product":"savings"}
SIGNIN_SCOPES=accounts:read transactions:read
SCOPED_TOOL=list_accounts
```

Payments need `payments:write` too, and the Inspector's operation steps need to know what to propose. Give it a list to choose between, and a standing permission so it can show the difference:

```
SIGNIN_SCOPES=accounts:read payments:write
OPERATIONS=[{"label":"Pay Tidewater Energy $96.40","tool":"pay_payee","arguments":{"payee_id":"pye_ada_energy","from_account_id":"acc_ada_everyday","amount":"96.40","reference":"October"}},
            {"label":"Pay Fernhill Rent $1,450.00 (needs your approval)","tool":"pay_payee","arguments":{"payee_id":"pye_ada_rent","from_account_id":"acc_ada_everyday","amount":"1450.00","reference":"November rent"}}]
STANDING_PERMISSION=1
```

The demo customer Ada has the saved payees `pye_ada_rent`, `pye_ada_energy` and `pye_ada_friend` (list them with `list_payees`), and the accounts `acc_ada_everyday` and `acc_ada_saver`.

## Decisions

- **Direct and Device Sign-In only.** Mediated Sign-In has the agent type the customer's password. A bank should not demonstrate that, so it is off.
- **Two kinds of payment, by size.** A payment to a saved payee up to $250.00, or a transfer between the customer's own accounts up to $5,000.00, may be confirmed by an agent under a standing permission. Above those limits the operation sets `user_approval_required`, and the bank refuses a confirmation that claims a standing permission. Only one the person approved (`approved_by: user`) is accepted.
- **Proposing a payment reveals whether the account can cover it.** A token with only `payments:write` could therefore learn roughly what an account holds by proposing different amounts, without `accounts:read`. The scope's description says so, so the customer sees it when granting the scope. Nothing moves until a proposal is confirmed.
- **An agent can only pay saved payees.** There is no tool to add one. Adding a payee is a task the bank will not offer to agents (phase 6).
- **A payment moves money once.** The operation id is the idempotency key, and the funds are checked again when the payment is performed, since the balance may have changed since it was proposed.
- **Balances and transactions are separate scopes.** `list_accounts` needs `accounts:read` and `list_transactions` needs `transactions:read`. A transaction never carries a balance, so a token can be given one view without the other.
- **Another customer's account looks like no account.** Asking for it returns the same "No account" answer as an id that does not exist.
- **A demonstration sign-in.** The site's own login asks you to pick one of two fictional customers, with no password, like Poppy Travel. Anyone who reaches the deployed site can pick either. That is acceptable only because the data is fictional.
- **State is in memory.** One instance, and a restart resets everything.
