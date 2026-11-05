# Nova Bank

A fictional bank that shows what a personal agent can do with the Personal Agent Protocol. It is a Poppyseed site, like Poppy Travel in `site/`, with a banking theme and a short list of services. Nothing here is real: no money, accounts or people.

**Status:** phase 1 of 8. The scaffold, the published rates and branches (no sign-in needed), and the sign-in plumbing are in place. Accounts, transactions, payments, support chat, browsing and blocking come next. The plan is in the project history; each phase adds one capability.

| Service | Shows | Phase |
| --- | --- | --- |
| Rates and branches | A signed-out agent doing useful work | 1, done |
| Accounts and balances | Sign-in (Direct and Device) and scopes | 2 |
| Transactions | A second scope, separate from balances | 2 |
| Payments | A human approving a sensitive operation | 3 |
| Support chat | A Company Agent, with handoff to staff | 4 |
| Online banking pages | An agent's browser joining its Session | 5 |
| Blocking (all of the above) | Excluded tasks, and blocking a specific agent | 6 |

## Run

```sh
pnpm --filter nova-bank dev    # http://localhost:3000
```

Set `POPPYSEED_BASE_URL` to the address you serve it from (default `http://localhost:3000`). In production `POPPYSEED_BASE_URL` and `POPPYSEED_SECRET` (32 or more characters) are required.

To watch an agent use it, run the Inspector with `TARGET_URL` pointing here, and set `PUBLIC_TOOL=get_rates` so its "call a public tool" step uses a Nova tool.

## Decisions

- **Direct and Device Sign-In only.** Mediated Sign-In has the agent type the customer's password. A bank should not demonstrate that, so it is off.
- **A demonstration sign-in.** The site's own login asks you to pick one of two fictional customers, with no password, like Poppy Travel. Anyone who reaches the deployed site can pick either. That is acceptable only because the data is fictional.
- **State is in memory.** One instance, and a restart resets everything.
