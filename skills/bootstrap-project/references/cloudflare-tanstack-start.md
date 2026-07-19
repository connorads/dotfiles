# Cloudflare platform wiring (blessed path: TanStack Start)

Last verified: 2026-07. If anything below contradicts what you observe during
a bootstrap, update this file to match reality (see "Keep references honest"
in SKILL.md).

## Scaffold

```bash
pnpm create cloudflare@latest <name> --framework=tanstack-start \
  --platform=workers --no-deploy --no-git --no-agents --no-open
```

- **Never pass `-y` / `--accept-defaults` on the framework path.** It silently
  discards `--framework` and scaffolds the hello-world Worker instead: exit 0,
  `SUCCESS` banner, no warning, and a tree that looks like a real scaffold
  until you notice `package.json` has zero TanStack or React deps. Pass every
  flag explicitly, as above. Verified by single-variable repro (2026-07):
  adding only `-y` to the working command flips the output template.
- The decline-git-and-deploy flags are `--no-git` (not `--no-git-init`, which
  hard-errors) and `--no-deploy`.
- c3 **delegates to each framework's own CLI** and layers Cloudflare config on
  top, so output tracks upstream framework releases rather than lagging them.
  The delegated tool owns most of the tree, which is the root of the gaps
  below - c3's own flags only bind the parts c3 still writes.
- Defaults to a **Workers** project; Pages requires an explicit
  `--platform=pages` (don't - Workers is the current platform).
- Other frameworks: `--framework=<x>` (c3 lists them); the platform wiring
  below applies broadly, the TanStack specifics don't.

## What the TanStack Start scaffold gives you

- `wrangler.jsonc` with `compatibility_flags: ["nodejs_compat"]`,
  `observability.enabled`, `upload_source_maps`, and
  `main: "@tanstack/react-start/server-entry"`.
- `@cloudflare/vite-plugin` wired in `vite.config`:
  `cloudflare({ viteEnvironment: { name: "ssr" } })` alongside
  `tanstackStart()`, `tailwindcss()`, `devtools()` and `viteReact()`. The Vite
  plugin is the current recommended Cloudflare setup - not the older
  Wrangler-only flow.
- Tailwind 4 and file-based routing under `src/routes/`.
- A `deploy` script: build + `wrangler deploy`.
- **A generated route tree at `src/routeTree.gen.ts`** (rebuilt by
  `tsr generate`). Note the name: it's `.gen.ts`, so the house
  `**/*.generated.*` exclude used by the lint/typos tiers does not match it -
  it gets treated as handwritten source unless excluded explicitly during the
  harden phase.

**`wrangler.jsonc` is not the config that ships.** `pnpm build` emits
`dist/{client,server}` (there is no `.output`), and `@cloudflare/vite-plugin`
merges the hand-written `wrangler.jsonc` into a **generated
`dist/server/wrangler.json`** - that is what `wrangler deploy` actually reads.
The `assets` block being commented out in `wrangler.jsonc` is therefore not a
gap: the generated file carries `"assets": {"directory": "../client"}`, so
static assets *are* served by a Workers assets binding, just one the plugin
writes. Uncomment the hand-written block only if you need a named `ASSETS`
binding to fetch from in code. Verified 2026-07 by reading
`dist/server/wrangler.json` after a build.

## Known gaps (post-scaffold steps)

- **`compatibility_date` is stale, and c3 says otherwise.** c3 prints
  "Retrieving current workerd compatibility date" with today's date, then
  leaves the delegated template's own value in `wrangler.jsonc` (observed
  2026-07: reported `2026-07-14`, file said `2025-09-02` - ~10 months old).
  The same c3 run *does* apply the current date on the hello-world path, so
  this is specific to the framework path, where the delegated template wins.
  Bump it by hand after scaffolding and check the release notes between the
  two dates - a compat date silently governs runtime behaviour.
- **No bindings are scaffolded.** D1 / KV / R2 / Durable Objects must be added
  to `wrangler.jsonc` by hand; access them via `import { env } from
  "cloudflare:workers"`. Run `wrangler types` afterwards to regenerate the
  `Env` types.
- **Tests are wired but empty.** You get `vitest`, `@testing-library/react`,
  `jsdom` and a `"test": "vitest run"` script, but no vitest config and no
  test files - `pnpm test` passes without running anything. Add a config
  (`environment: "jsdom"`) and at least one real test, or the test tier of the
  hooks gates nothing.
- **`--no-agents` does not stop TanStack writing `AGENTS.md`.** The flag only
  suppresses c3's Cloudflare AGENTS.md; the delegated TanStack CLI writes its
  own (~14KB of TanStack Intent skill mappings) regardless. Decide
  deliberately whether to keep it, and reconcile with the house AGENTS.md the
  bootstrap seeds - two files competing for the same filename is the failure
  mode. It is delimited by `<!-- intent-skills:start/end -->` markers and is
  machine-regenerated, so house prose can live around the block rather than
  replacing it.
- **The house formatter destroys that block - exclude `AGENTS.md` from oxfmt.**
  Its content is YAML entries embedded in markdown, and Ultracite's oxfmt preset
  sets `proseWrap: "never"`, which joins each multi-line `id:`/`run:`/`for:`
  entry onto a single line (97 lines → 39, ids and descriptions merged into one
  string). Nothing errors; the block is just left silently unparseable.
  Add `AGENTS.md` (and the `CLAUDE.md` symlink) to `ignorePatterns` in
  `oxfmt.config.ts` during the harden phase, and exclude them from the hk step's
  glob as well - oxfmt honours its own `ignorePatterns` even for paths passed
  explicitly, so a commit touching only `AGENTS.md` otherwise fails the gate on
  an empty target set (see the `hk` skill's Gotchas).
- Prerendering needs `@tanstack/react-start` >= 1.138.0.

## Churn watch

- TanStack's own scaffolder migrated `@tanstack/create-start` → the unified
  `@tanstack/cli` (`pnpm dlx @tanstack/cli create`). Prefer c3 regardless - it
  delegates upstream *and* wires the Cloudflare layer. As of 2026-07 the tool
  c3 delegates to writes `.cta.json` (create-tanstack-app) and runs TanStack
  Intent for agent config, so the delegation target is still settling.
- Wrangler can auto-detect TanStack Start and synthesise config if none
  exists; a scaffolded `wrangler.jsonc` still beats relying on that.

## Deploy

**`pnpm deploy` cannot be rehearsed - it deploys for real.** The scaffolded
script is `pnpm run build && wrangler deploy`, so pnpm appends your arguments
*after the final command in the chain*: `pnpm deploy --dry-run` runs
`... && wrangler deploy deploy --dry-run`-style nonsense that still performs a
live deploy to `*.workers.dev`, and `pnpm deploy --help` does the same. There is
no confirmation prompt. Observed 2026-07: an intended dry-run published the
scaffold to a public URL; `wrangler delete --name <name> --force` removed it.

Rehearse by calling the tool directly, never through the script:

```bash
pnpm exec wrangler deploy --dry-run
```

This is worth flagging in the project's AGENTS.md - it is a one-keystroke gap
between "check the config" and "publish to the internet", and it bites hardest
during a bootstrap, when nobody expects the repo to be deployable yet.

Route the real thing to the `cloudflare-workers-deployments` skill: it owns the
choice between Workers Builds (Cloudflare-hosted, Git-connected) and local
`wrangler deploy`, plus custom domains and Access.

## Watch-item: Alchemy (alchemy.run)

TypeScript-native IaC that replaces `wrangler.jsonc` as the source of truth -
resources declared in an `alchemy.run.ts` script, deployed via the Cloudflare
API, env types inferred with no codegen. Not the blessed path because (as of
mid-2026, v0.93): pre-1.0 with a parallel v2 rewrite on Effect in flight, and
TanStack Start supported only via example repos, not a first-class create
template. It still uses wrangler for local dev.

Re-evaluate when any of: v1.0 ships, the v2/Effect line settles as the single
line, or a first-class TanStack Start template appears in `alchemy create`.
