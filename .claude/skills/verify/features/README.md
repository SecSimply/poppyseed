# poppyseed/next verification map

The maintained source for proving each part of the Personal Agent Protocol through `poppyseed/next`. Read this index first, then use the feature file as the recipe.

## Baseline preconditions

- `fixture.sh start` printed `✓ fixture ready at http://localhost:3110`, and `fixture.sh doctor` passes.
- The server is the reference company (`Reference Company`) with test hooks on.
- Each run starts from a fresh `fixture.sh start`: the store is in memory, so a restart is a clean slate.

## Driving conventions

- Drive through `fixture.sh check --only <prefixes>`; the prefixes in each file select its checks.
- Treat check ids as stable handles; their titles say what they prove.
- Use the test agent CLI or curl only to explore; proofs come from checks.

## Proof and skip reporting

- Quote the run directory and the summary line.
- A check skipped for a missing hook is not verified. Say which hook.
- Do not report a feature verified through `nova/` (Protea Bank) or the in-process suite alone.

## Features

- [Discovery, Sessions and tools](./discovery-and-tools.md): poppy.json, agent identity, Session Tokens, DPoP, MCP and OpenAPI tools.
- [Signing in](./sign-in.md): Direct, Device and Mediated Sign-In, Account Tokens, signing out.
- [Operations](./operations.md): propose, confirm, track and cancel actions.
- [Conversations](./conversations.md): the Company Agent, handoff to staff, Direct Conversations.
- [Web browsing](./web-browsing.md): a browser joining the Session on the site.
