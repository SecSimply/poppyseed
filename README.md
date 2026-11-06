# Poppyseed

Let personal AI agents use your Next.js site. Poppyseed implements the [Personal Agent Protocol](https://personalagentprotocol.org/) (Poppy for short, draft 0.3): agents find your site, sign people in with their consent, call your tools, and buy only what people approve.

**[withpoppyseed.dev](https://withpoppyseed.dev)**. Using a coding agent? Copy the prompt from the site and paste it in.

```sh
npm install poppyseed zod
```

```ts
// poppyseed.config.ts
import { definePoppyseed, memoryStore, tool } from "poppyseed";
import { z } from "zod";

const dev = process.env.NODE_ENV === "development";

export const poppyseed = definePoppyseed({
  organization: { name: "Poppy Travel", domain: dev ? "localhost" : "poppy.travel" },
  secret: process.env.POPPYSEED_SECRET!, // 32+ random characters
  store: memoryStore(),
  ...(dev && { baseUrl: "http://localhost:3000", dev: { allowInsecureClients: true } }),
  tools: {
    search_flights: tool({
      description: "Search one-way flights",
      scope: null, // anyone, signed in or not
      input: z.object({ from: z.string(), to: z.string(), date: z.iso.date() }),
      run: (input) => ({ offers: searchFlights(input) }),
    }),
  },
});
```

```ts
// app/api/poppyseed/[...path]/route.ts
import { toNextHandlers } from "poppyseed/next";
import { poppyseed } from "@/poppyseed.config";

export const { GET, POST, DELETE } = toNextHandlers(poppyseed);
```

```ts
// next.config.ts
import { withPoppyseed } from "poppyseed/next/config";

export default withPoppyseed(nextConfig); // wraps your existing config
```

Your site now serves discovery at `/.well-known/poppy.json`, agent sign-in with OAuth and DPoP, and your tools over MCP and OpenAPI. Try it as an agent: `npx poppyseed agent http://localhost:3000`. The [Quickstart](docs/quickstart.md) walks through it.

## Add more when you need it

| You want | Add |
| --- | --- |
| Tools that need the person's account | `scope` on the tool, plus `accounts` and `signIn`. Poppyseed serves the consent pages. |
| Purchases people approve first | `operation: { propose, perform }` instead of `run`. |
| A support agent | `conversations: { agent: claudeAgent({ instructions }) }`, with handoff to your staff. |
| Agents' browsers on your pages | `web: {}`, then `poppyseed.browserSession(request)`. |
| Serverless or several servers | `store: postgresStore(pool)`. |

See the [Guides](docs/guides.md).

## Verified

A conformance suite checks the spec's company-side rules over HTTP. Through a Next.js production server Poppyseed passes 107 checks and fails none; the one skipped needs a public agent URL. Each check is proven by breaking its rule on purpose. Run it against your site:

```sh
npx poppyseed check http://localhost:3000
```

## Docs

- [Quickstart](docs/quickstart.md)
- [Guides](docs/guides.md)
- [How the protocol works](docs/concepts.md)
- [Configuration](docs/configuration.md)
- [Deploying](docs/deployment.md)
- [Testing your site](docs/testing.md)

Also at [withpoppyseed.dev/docs](https://withpoppyseed.dev/docs).

## One package

[`poppyseed`](packages/core/README.md) is all you install. Each part is its own entry point, and the package has no side effects, so your site only bundles what it imports:

| Import or command | What it is |
| --- | --- |
| `poppyseed` | The protocol on Web `Request`/`Response`. |
| `poppyseed/next`, `poppyseed/next/config` | The Next.js App Router adapter. |
| `npx poppyseed agent`, `poppyseed/agent` | A personal agent for your terminal and tests. |
| `npx poppyseed check`, `poppyseed/conformance` | Checks any site against the spec. |

## Contributing

| Path | What |
| --- | --- |
| `packages/core` | The `poppyseed` package. |
| `fixtures/` | The reference company the checks run against. |
| `nova/` | Protea Bank, a fictional South African bank that demonstrates sign-in, approvals, support chat, browsing and blocking. |
| `inspector/` | The Poppy Inspector, a protocol debugger that runs a real agent against a site and shows every request. |
| `spec/` | The official text, its numbered requirements, and [what verifies each](spec/STATUS.md). |

```sh
pnpm install
pnpm dev          # the site, at http://localhost:3000
pnpm verify       # spec gate, typecheck, unit tests, in-process conformance (also the pre-push hook)
pnpm e2e          # every check over HTTP through a Next.js production build
pnpm mutants      # break each rule on purpose; its check must fail
pnpm quickstart   # run docs/quickstart.md as written in a fresh Next.js app
```

Versions follow the spec: poppyseed `X.Y.*` implements Poppy `X.Y`, and the patch number is ours. To release, set the version in `packages/core/package.json`, commit, and push a tag such as `v0.3.0`. The `release` workflow reruns every gate and stages it on npm through trusted publishing, with no token; release it with `npm stage list poppyseed`, then `npm stage approve <stage-id>`. Project rules are in [AGENTS.md](AGENTS.md).

## License

MIT. The spec text in `spec/source/` is © its authors under Apache 2.0. The protocol is a draft, so expect changes. Poppyseed is an independent implementation, not affiliated with the protocol's authors. The names Personal Agent Protocol and Poppy are theirs.
