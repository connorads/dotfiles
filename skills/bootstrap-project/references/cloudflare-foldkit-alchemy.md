# Cloudflare platform wiring: the all-Effect stack (Foldkit + Effect Worker + Alchemy)

Last verified: 2026-09. Scaffold observed live with `create-foldkit-app`
0.31.1 (foldkit 0.154.0, effect 4.0.0-rc.112); alchemy facts from the
2.0.0-beta.76 docs and two shipped projects on beta.72 (foldkit 0.147,
effect rc.109). If anything below contradicts what you observe during a
bootstrap, update this file to match reality (see "Keep references honest"
in SKILL.md).

## Contents

What this path is · Versions · Scaffold · Why two Workers · Dev and stages ·
Harden · Verify · Deploy · Traps · Re-evaluate when · Worked examples ·
Deeper.

## What this path is

The second blessed Cloudflare path, opt-in by name ("the Effect stack",
"Foldkit", "Alchemy"). One language end to end:

- **Foldkit** SPA in `frontend/` - the Elm architecture on Effect, no JSX.
- **Effect v4 Worker** in `backend/` - Effect RPC over ndjson at `/api/rpc`,
  Durable Objects as Effect classes, hibernatable WebSockets.
- **`packages/protocol`** - the shared Effect Schemas both sides import
  (brands, RPC group, tagged errors, WS event unions). Defined once, never
  redeclared.
- **Alchemy v2** as the only build and deploy tool. `alchemy.run.ts` is the
  source of truth; there is no `wrangler.jsonc` anywhere.

Everything here is pre-release: alchemy 2.0.0-beta, effect 4.0.0-rc, foldkit
0.x. That is why this is a named path and not the default, and why the
version rules below are strict. For the React alternative on the same tool
(TanStack Start + Alchemy) see the Alchemy section of
`cloudflare-tanstack-start.md`.

This file covers platform wiring and repo shape. Code idioms live
elsewhere: the scaffolder's own `FOLDKIT.md` for Foldkit, the vendored
`effect` skill for Effect v4, the vendored `alchemy` skill
(`python3 scripts/search.py <terms>`) for resources and CLI.

## Versions

- **Effect v4 is mandatory, and `effect@latest` is still 3.x.** Foldkit pins
  its `effect` peer to an exact rc; alchemy requires `>= 4.0.0-beta.105`.
  Never `pnpm add effect` bare - take the exact version the installed
  `foldkit` pins and use it in every package.
- **Version island rule.** `effect`, `@effect/*`, `foldkit`, `@foldkit/*` and
  `alchemy` are pinned exact and move together or not at all. Never bump one
  alone; never a range on `effect`. Two different rcs in one workspace is a
  duplicate-Effect bug that presents as nonsensical type errors.
- **The 4-day quarantine applies to the scaffolder too.** Foldkit publishes
  most days, so `pnpm dlx create-foldkit-app` resolves to a release at least
  four days old (observed: 0.31.1 while 0.32.1 was current) and pins the
  foldkit of that day. Take the newest release that clears the gate rather
  than weakening the gate; a freshly published foldkit or effect prerelease
  can be rejected at install for the same reason.
- **Node.** The alchemy CLI type-strips `alchemy.run.ts` natively, so it
  needs Node >= 22.18; observed ceiling 25 (Node 26 has no loader story yet,
  as of gridguess in 2026-07). `mise use node@24 pnpm@11`.

## Scaffold

### 1. Frontend via the official scaffolder

```bash
mkdir <name> && cd <name> && git init
pnpm dlx create-foldkit-app -n frontend -r spa -e counter -p pnpm
```

Flags: `-n/--name` (also the directory), `-r/--rendering` `spa|ssg|ssr`,
`-e/--example` (30 SPA starters; `counter` is the smallest), `-p` package
manager. There is no `--no-install` or `--no-git`: it runs the install
itself (green under quarantine when observed) and does not `git init`.

What it writes, and what to do with each:

- `FOLDKIT.md` - Foldkit's own agent conventions; Foldkit owns it and
  replaces it whole on upgrade. Keep. `AGENTS.md` beside it is yours; the
  house AGENTS.md at the repo root links to both.
- `AGENTS.md` carries `subtree_prompted: false`. The scaffolder and
  `FOLDKIT.md` offer to vendor the whole foldkit repo as a git subtree at
  `repos/foldkit`. **Decline** and set the line to `true`. House rule: read
  installed source under `node_modules`, clone to `/tmp` at the installed
  tag when the examples are needed. Note the console suggests `main
  --squash`; `FOLDKIT.md` correctly says the release tag.
- `.mcp.json` - the Foldkit devtools MCP (`@foldkit/devtools-mcp`, via
  `npx -y`). Keep if the project wants agents reading live Model state.
- `.oxlintrc.json` extends `@foldkit/oxlint-plugin/recommended.json` (29
  framework rules, e.g. `no-noop-message`,
  `no-impure-call-at-decision-time`, `no-hardcoded-route-strings`) and sets
  `typescript/consistent-type-assertions: never`. Keep; extend at harden.
- `.prettierrc` / `.prettierignore` / `format` script - replaced by oxfmt at
  harden.
- `vite.config.ts` (`foldkit({ devToolsMcpPort })` + tailwind),
  `vitest.config.ts` (happy-dom, `server.deps.inline` for the foldkit
  packages), `tsconfig.json` (strict + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`). Keep; retarget tsconfig at the root base.
- `pnpm-workspace.yaml` + `pnpm-lock.yaml` **inside `frontend/`**, with an
  `allowBuilds` block (`esbuild: true`, `msgpackr-extract: false`). A nested
  workspace file makes `frontend/` its own workspace root. Delete both,
  carry the `allowBuilds` decisions to the root file, and re-decide `esbuild`
  there - the scaffolder approved that build script for you.

`ssg` and `ssr` exist (`ssr` scaffolds a Node `server/main.ts` on
`@effect/platform-node`; alchemy's `examples/cloudflare-foldkit-ssr` is the
Worker variant with `htmlHandling`/`notFoundHandling: "none"`). Neither is
proven here. Start from the SPA path.

### 2. Root workspace

`pnpm-workspace.yaml`:

```yaml
packages:
  - frontend
  - backend
  - packages/*

# Dependency build scripts stay off. pnpm 11 fails the install outright on
# unreviewed ones (ERR_PNPM_IGNORED_BUILDS); each is acknowledged here.
allowBuilds:
  esbuild: false
  msgpackr-extract: false
  workerd: false
```

Root `package.json` scripts - alchemy is the only build command:

```json
{
  "dev": "alchemy dev",
  "deploy": "alchemy deploy",
  "destroy": "alchemy destroy",
  "test": "pnpm -r test",
  "check": "pnpm -r exec tsc --noEmit",
  "lint": "oxlint --deny-warnings ."
}
```

`tsconfig.base.json` (every package extends it; the root `tsconfig.json`
extends it with `"include": ["alchemy.run.ts"]`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`mise.toml`: `node = "24"`, `pnpm = "11"`. `.gitignore`: `node_modules/`,
`dist/`, `.alchemy/`, `.env`, `.env.*`.

### 3. Protocol and backend packages

- `packages/protocol/package.json`: `exports: { ".": "./src/index.ts" }`,
  `effect` exact; dev `@effect/vitest`, `fast-check`, `vitest`,
  `typescript`.
- `backend/package.json`: `effect` and `alchemy` exact, the protocol as
  `workspace:*`; dev `@cloudflare/workers-types`, `@effect/vitest`,
  `vitest`. `test` script `vitest run --passWithNoTests` until tests exist.
- `frontend/package.json` gains `@effect/platform-browser` (same exact
  version) and the protocol as `workspace:*`.

Backend source shape: `src/server.ts` default-exports the Effect Worker
class (RPC group from the protocol, DO classes, `Cloudflare.upgrade()` for
WebSockets); `src/worker.ts` is the shim below. The Effect and alchemy
idioms for the Worker body are the vendored skills' job, not this file's.

### 4. `alchemy.run.ts` - the two-Worker shape

```typescript
import { ALCHEMY_DEV, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Console, Effect } from "effect";

import Backend from "./backend/src/server.ts";

// Remote state: prod is durable and every stage plus CI share one encrypted
// source of truth. Cloudflare.state() uses the account-wide alchemy state
// store Worker + Secrets Store, bootstrapped once on first run.
export default Stack(
  "<Name>",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const stack = yield* Stack;
    yield* Backend;

    const devPort = 5173;
    yield* Cloudflare.Website.Foldkit("Website", {
      ...(stack.stage === "prod" ? { name: "<name>" } : {}),
      rootDir: "frontend",
      main: "../backend/src/worker.ts",
      assets: { runWorkerFirst: ["/api/*"] },
      env: { BACKEND: Backend },
      dev: { port: devPort, strictPort: true },
    });

    // alchemy's Vite dev never calls printUrls(), so `alchemy dev` prints no
    // URL for the site. The Stack body runs on every command - gate the log.
    if (yield* ALCHEMY_DEV) {
      yield* Console.log(`\n  Website: http://localhost:${devPort}\n`);
    }
  }),
);
```

`backend/src/worker.ts`, the shim (this is the whole file):

```typescript
// Vite worker main: a same-origin shim only. runWorkerFirst routes /api/*
// here; everything else is static assets. The real backend is its own
// alchemy-bundled Worker behind the BACKEND service binding. This module
// must import nothing from alchemy (see "Why two Workers").
type ShimEnv = {
  BACKEND: { fetch(request: Request): Promise<Response> };
  ASSETS: { fetch(request: Request): Promise<Response> };
};

export default {
  async fetch(request: Request, env: ShimEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return env.BACKEND.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
```

- `Cloudflare.Website.Foldkit` is `Website.Vite` with Foldkit defaults
  (`notFoundHandling: "single-page-application"`, memo hashing of the
  project). It shipped in 2.0.0-beta.73 (2026-08-21); on beta.72 or older
  use `Website.Vite` and set `notFoundHandling` yourself. Both accept
  `main`, `env`, `assets.runWorkerFirst`, `dev`.
- Bindings in `env` reach the Worker entry only. The SPA runs in the
  browser: anything it needs comes through a route the Worker serves, or a
  `VITE_`-prefixed key inlined at build time (never a secret).
- Per-stage secrets: `Alchemy.makeRandom("Key", { bytes: 32 })` in the
  Backend's `env`, read at init with `Config.redacted(...)`. Minted once,
  persisted in state, stable across deploys.

## Why two Workers

The obvious shape is one `Website.*` resource whose `main` is the Effect
Worker class hosting the DOs. It typechecks and `vite build` succeeds, but
it cannot run under `alchemy dev` (gridguess ADR 0002, beta.63/64): the Vite
dev path evaluates `main` through the Cloudflare vite plugin's module
runner inside workerd, which cannot tree-shake, so importing
`alchemy/Cloudflare` drags in the CLI arms (workerd launcher, rolldown,
vite itself, CJS deps) and the dev wrapper then requires the default export
to be a `WorkerEntrypoint` subclass or a `{ fetch }` object. Alchemy's
Effect bridge is injected only by alchemy's own bundler, never on the Vite
path.

So: `main` is a plain `{ fetch }` shim that imports nothing from alchemy,
and the Effect Worker is a separate `Cloudflare.Worker` bundled by alchemy's
own pipeline, joined by a service binding. The browser still sees one
origin - no CORS, no WS origin checks. WebSocket upgrades traverse shim,
binding, backend, DO stub; verify upgrade forwarding when the WS route lands.

A single Worker with `main` is fine when the edge code really is a plain
fetch handler (a health route, a KV read) - that is exactly what upstream
documents. Revisit collapsing to one Worker if alchemy ships an Effect
bridge for the Vite main path.

## Dev and stages

- `alchemy dev` runs Workers in workerd against **local simulators** and
  runs every `Website.*` under its framework's own dev server (native HMR,
  `dev:`-prefixed resource ids, no cloud calls) - per the beta.76 docs. Note
  the history: at beta.63 (2026-07) dev provisioned real remote resources
  into `dev_$USER`, and sharing that stage with `deploy` produced a
  service-binding race (gridguess ADR 0003). Defaults today: dev uses
  `dev_$USER`, deploy uses `live_$USER`; pass `--stage prod` for prod.
- Browser Rendering under dev is a local headless Chrome, not the real
  service (observed, quibble). Verify capture-style behaviour on a deployed
  stage.
- State lives in the account-wide state store, never in `.alchemy/`
  (gitignored; legacy `--local` inspection only). First run of `deploy`,
  `plan` or `dev` offers the one-time bootstrap; `alchemy cloudflare
  bootstrap` is the idempotent repair path.

## Harden - deltas from the generic phase

- **oxfmt replaces Prettier.** Remove `prettier`,
  `@trivago/prettier-plugin-sort-imports`, `.prettierrc`, `.prettierignore`
  and the `format` script; add `oxfmt`.
- **oxlint.** Keep the scaffold's `extends` (foldkit plugin) and
  `consistent-type-assertions: never`; add `no-console: error` and
  `typescript/no-non-null-assertion: error` (an `overrides` entry relaxes
  the latter for `**/*.test.ts`). Run as `oxlint --deny-warnings` - oxlint
  exits 0 on warnings otherwise, so without the flag the gate gates nothing.
- **Config boundary as a grep gate.** Runtime config is read through Effect
  `Config`, never `process.env` in app source. A one-line hk step
  (`grep -nE 'process\.env' "$@"` and fail) over `backend/src`,
  `frontend/src`, `packages/protocol/src`; `alchemy.run.ts` is out of scope
  by glob.
- **hk tiers** (compose from the `hk` skill): 1 fix+restage `oxfmt`,
  `typos`; 2 gate `oxlint --deny-warnings`, `gitleaks git --staged`, the
  config-boundary step; 3 `tsc --noEmit` per package plus a `tsc-root` step
  for `alchemy.run.ts`; 4 `vitest` per package with `depends` on its tsc
  step. `exclude = List("node_modules", "dist", ".alchemy")`.
- **Build scripts.** The root `allowBuilds` block is load-bearing on the
  build container: pnpm 11 fails an install outright on an unreviewed
  dependency build script, and the local install never sees it because the
  global `ignoreScripts` masks the check. Run the `hk` skill's build-script
  check; `supply-chain-hardening` owns each `true`/`false`.
- **`.node-version`.** A June project needed a bare `.node-version`
  (>= 22.18) because Workers Builds read that file, not `mise.toml`, and its
  default Node predated native type stripping. An August project deploys on
  Workers Builds without one. Verify at first deploy: if the build fails
  loading `alchemy.run.ts`, add the file (bare - the image parses the whole
  file as the version, so no comment).

## Verify

- `pnpm check`, `pnpm lint`, `pnpm test` green in every package. The bare
  scaffold at 0.31.1 was: typecheck clean, lint clean, 2 files / 10 tests.
- `pnpm --filter frontend exec vite build` still works for the SPA (client
  only). There is no standalone build for the whole stack: alchemy drives
  Vite programmatically inside `deploy`, with no on-disk artefact.
- Dev server: `pnpm dev`, then the port logged from `alchemy.run.ts`. Bind
  the Vite dev host to `127.0.0.1` in `dev` if the machine exposes
  interfaces.
- After a deploy: `curl <site>/api/health` returns the health JSON, then an
  Effect RPC round trip over ndjson at `/api/rpc` proves the
  Website-to-BACKEND binding.

## Deploy - Workers Builds, checks-only GitHub

Two lanes, so no Cloudflare credential ever lives in GitHub (Cloudflare has
no OIDC for its API, only long-lived tokens):

- **Prod deploys run inside Cloudflare.** Workers Builds watches `main` and
  runs `pnpm run deploy --stage prod --yes`. `--yes` is load-bearing:
  alchemy detects the non-interactive terminal and refuses the plan without
  it. The build's own token is injected as `CLOUDFLARE_API_TOKEN`; set
  `CI=true` so the state-store credentials resolve from the Secrets Store on
  every run instead of a credentials file.
- **GitHub Actions runs checks only**, holding no secrets:

  ```yaml
  on: { pull_request: , workflow_dispatch: }
  permissions: { contents: read }
  jobs:
    check:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v5
        - uses: jdx/mise-action@v4
        - run: pnpm install --frozen-lockfile
        - run: pnpm lint
        - run: pnpm check
        - run: pnpm test
  ```

- **No PR preview stages.** They are the one thing that would need a
  Cloudflare token in GitHub, plus a teardown hook Workers Builds has no
  event for. Upstream's alternative ("credentials as code": an `admin`
  profile minting a scoped token from `stacks/github.ts`, `pr-<n>` stages)
  is documented in the vendored alchemy skill under `environments--ci`; an
  earlier project found it needs the Global API Key as the admin credential.
  Not the house default.

Token and trigger details (observed on Workers Builds, 2026-08):

- The build token is a dedicated user token scoped to Workers Scripts
  Write, Workers R2 Storage Write, **Secrets Store Write** and Account
  Settings Read. Write, not Read: the state store hands back its bearer
  token by binding a Secrets Store secret to an ephemeral Worker. The token
  Cloudflare auto-generates for Workers Builds lacks it and cannot read
  state.
- The trigger attaches to the **Website Worker's script tag**, not its name.
  Builds tracks and can roll back only that Worker; the backend deploys as a
  side effect of the same alchemy run and shows no git linkage. Delete and
  recreate that Worker and the trigger orphans silently -
  `cf workers-builds triggers list --external-script-id <tag>` returning
  empty is the symptom.
- Record the live URL, the token's scope names and the secret names (never
  values) in the project's AGENTS.md Deploy section.

## Traps (all observed)

- `pnpm run deploy` / `pnpm run destroy`, never bare `pnpm deploy` - a pnpm
  builtin that does not run the script.
- Alchemy keys resources by namespace + id only, not type. A logical id
  reused across resources resolves to the first registration and silently
  no-ops the rest. Every id unique stack-wide.
- `Website.*` inlines `VITE_`-prefixed `env` keys into the client bundle,
  `Redacted` values unwrapped. Unprefixed keys become Worker bindings.
- The alchemy CLI log can print a *candidate* worker hostname it checked,
  not the one it assigned. Read the real host from the dashboard or the
  deployed bundle.
- `alchemy plan --stage prod` reported `update` for both Workers immediately
  after a clean deploy (beta.63/64). A fully `noop` plan is not a reliable
  "state matches live" signal.
- `alchemy dev` prints no URL for a `Website.*` site; log the pinned port
  from the Stack body.
- The scaffold's nested `pnpm-workspace.yaml` (see Scaffold step 1).

## Re-evaluate when

Any of: alchemy 2.0 GA; effect 4.0 GA; foldkit 1.0; alchemy ships an Effect
bridge for the Vite `main` path (collapse to one Worker); the `ssr`
template is proven on a Worker here. Re-date the banner at the top with the
new versions when you do.

## Worked examples on this machine

Local paths, not links - sanitise before this skill is published:

- `~/git/website-comments` (quibble): the complete shape - protocol,
  backend with DO and RPC middleware, Foldkit SPA, Workers Builds deploy,
  11 ADRs, `.agents/skills/verify`. Built on beta.72 with `Website.Vite`.
- `~/git/foldkit-demo` (gridguess): origin of the two-Worker shape (ADR
  0002) and the stage-isolation finding (ADR 0003).
- `~/git/alchemy-cf-app`: TanStack Start + Alchemy, the id-collision trap,
  the `.node-version` trap, the credentials-as-code CI variant (uncommitted
  ADR 0008).

## Deeper

- Vendored alchemy skill pages: `cloudflare--frontend--foldkit`,
  `cloudflare--local-development`, `state-store--index`,
  `environments--ci`, `cli--dev`, `cli--deploy`.
- Foldkit: `frontend/FOLDKIT.md` (after scaffold), `https://foldkit.dev/llms-full.txt`,
  `packages/create-foldkit-app/templates` in the foldkit repo.
- Effect v4 conventions: the vendored `effect` skill.
