# Poppyseed

The easiest way to implement the Personal Agent Protocol (Poppy for short; we write PAP only in internal names like `spec/pap-0.3`) in Next.js: `npm install poppyseed`. pnpm monorepo, Node 22. In the repo, Node runs the TypeScript sources directly and vitest tests them; `pnpm pack` compiles the package to `dist/` for npm (`publishConfig` points the published exports there).

The project's website is https://withpoppyseed.dev (kept upstream, not in this repository); the docs are in `docs/`. User-facing docs and READMEs assume the package comes from npm: `npm install poppyseed`, `npx poppyseed agent`, `npx poppyseed check`. Never put monorepo commands (`pnpm --filter …`) or repo-internal paths in them; link into the repository with full GitHub URLs.

## Commands

Node 22, pnpm 10. `pnpm install` once, then:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Protea Bank at http://localhost:3000. |
| `pnpm verify` | The gate below. Run it before every commit. |
| `pnpm verify:full` | `pnpm verify`, plus `pnpm e2e` and `pnpm mutants`. |
| `pnpm --filter poppyseed test` | Core's unit tests alone, while iterating. |

## Layout

- `spec/source/` is the official text of personalagentprotocol.org, verbatim with SHA-256 sums. Never edit it; the `spec-snapshot` workflow refreshes it.
- `spec/pap-0.3/*.md` restates every normative sentence of the official text as one requirement line: ``- **MUST** · company · `area.slug` — Text.``
- `spec/STATUS.md` is generated. It shows each rule and what verifies it.
- `packages/core` is `poppyseed`, the one published package (unscoped; `@poppyseed` belongs to someone else). Each part is its own entry, and the package is `sideEffects: false`, so a site importing `poppyseed` never loads the rest:
  - `src/` (`poppyseed`): the protocol on Web Request/Response, WebCrypto and jose;
  - `src/next/` (`poppyseed/next`, `poppyseed/next/config`): the Next.js App Router adapter;
  - `src/agent/` (`poppyseed/agent`): a personal agent for tests that sends malformed requests on purpose and hosts agent metadata;
  - `src/conformance/` (`poppyseed/conformance`): requirement-tagged checks and `plan.ts` (roadmap legs);
  - `src/cli.ts`: the `poppyseed agent` and `poppyseed check` commands;
  - `scripts/`: `spec.ts`, `mutants.ts` and `mutants.data.ts` (repo tooling, not published).
- `fixtures/reference` is the reference company: every feature on, with test accounts and hooks. Its `test/conformance.test.ts` runs the suite in-process; the fixture app serves it over HTTP.
- `fixtures/next-app` serves the reference company through `poppyseed/next`. `pnpm e2e` and the `verify` skill drive it over HTTP.
- `packages/oidc` is `oidc-login`, a private package (not published): sign in with an OpenID Connect provider (Curity) by the authorization code flow with PKCE, shared by `nova` and `inspector`.
- `nova` is Protea Bank, a fictional South African bank on `poppyseed/next` that shows sign-in, human approval, support chat, browsing and blocking. Its `scripts/check-local.ts` runs `poppyseed check` against a local build. It is a demonstration, not a test target.
- `inspector` is the Poppy Inspector: a React and Node tool that runs a real `TestAgent` against one site and shows every request. It targets Protea Bank by default.

## Skills

- `spec-update` (`.claude/skills/`): bring the code in line with a change to the official spec.
- `verify` (`.claude/skills/`): build, start and drive the fixture app to prove `poppyseed/next` end to end, with evidence in `.verify/next/`.
- `security-check` (`.claude/skills/`): hold a change to the security invariants (tokens, DPoP, ownership, HTML, fetching, supply chain). Run it before every push that changes server code, workflows or dependencies.

## Gates

`pnpm verify` runs the spec gate, typecheck, unit tests and in-process conformance. The pre-push hook and CI run it as well. CI also runs `pnpm e2e` (the fixture app's production build over HTTP, every check through Next.js), `pnpm mutants` (each check must catch a deliberately broken rule; `--full` runs the whole suite per mutant) and `pnpm quickstart` (packs the package as npm would publish it and runs `docs/quickstart.md`, as written, in a fresh Next.js app).

`spec:check` fails when any of these is true:
- a company rule has neither a check nor a planned leg;
- a shipped leg has planned rules that no check covers;
- a shipped check has no mutant in `mutants.data.ts` and no `NOT_MUTATED` reason.

Judge a command by its exit code, never by grepping its output. `pnpm -s` hides the lines a grep would look for.

Run the `security-check` skill on every change before you push, and turn each real gap it finds into a check and a mutant, like any other rule.

Never skip, weaken or delete a check to get green. A failing check means the code or the spec is wrong, so fix whichever one is wrong.

## Testing: end to end first

Prove behaviour through the conformance suite, which runs the same checks in-process and over HTTP through Next.js. When a rule seems hard to observe from outside, give the reference company (`fixtures/reference`) a tool, a setting or a hook that makes it observable, and check it there. Write a unit test only for what no request can observe (store atomicity, the connect-time address check, fake-clock expiry, sealing keys, the Claude adapter's tool loop), and name that test in the rule's `manual` entry in `plan.ts`. No tautological tests: every unit test is named by a mutant in `UNIT_MUTANTS` (`scripts/mutants.data.ts`) that breaks the code it guards, and `pnpm mutants` fails if a unit test has none or still passes under its mutant.

## Design rules

- Subtract before adding. Prefer deleting a branch, helper or option over adding one; no speculative guards or settings.
- Deep modules: a small interface over real work. Collapse pass-through wrappers and one-caller helpers.
- Make invalid states unrepresentable. Model state as discriminated unions (operations, device sign-ins, conversations, consent forms), not flags and optional fields that must agree. Let the store's expiry and deletion carry lifecycle instead of `ended`/`revoked` flags.
- Validate at boundaries (requests, agent metadata, config), then trust the types. No `as` or `!` that hides a type too loose to say what's true.
- Keep the public API composable: plain `Request` to `Response`, tools as values you can define in any module and spread together, typed contexts (`ctx.account` exists for scoped tools) and typed operation terms.
- Core uses Web APIs. The one Node-only piece, the connect-time address check in `safe-fetch.ts`, reaches `node:*` through dynamic imports that run only on Node.

## Changing protocol behaviour

1. Find the rule in `spec/pap-0.3/`. Every rule must trace to a sentence in `spec/source/`; mark one stated without a BCP 14 keyword `*(implied)*`. Behaviour the official text doesn't define is an implementation choice, not a rule.
2. `pnpm spec:build && pnpm spec:check` lists what is uncovered.
3. Write a black-box check in `packages/core/src/conformance/checks/`. When the outside view cannot prove the rule, give the reference company a tool, profile entry or hook (`Hooks` in `packages/core/src/agent/types.ts`) that makes it observable.
4. Add a mutant that only the new check catches.
5. Implement it in `packages/core`, commit, then run `pnpm verify` and `pnpm mutants`. Mutants refuse to run on uncommitted core changes.

When a leg ships, bump `CURRENT_LEG` in `plan.ts`.

## Conventions

- Errors leave through `PoppyError`. Tools throw `ToolError` for messages agents may see. Any other error is logged and reported as "tool failed".
- Session tokens are opaque and sealed. Never log tokens or put them in URLs.

## When the official spec changes

The weekly `spec-snapshot` workflow fails and pushes the new text to the `spec-snapshot` branch. Merge it, and `spec:check` fails until `spec/pap-0.3/` is reconciled. Compare the diff of `spec/source/`, update the requirement lines, then run `pnpm spec:reconciled`.
