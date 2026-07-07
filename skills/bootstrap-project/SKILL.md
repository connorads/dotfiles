---
name: bootstrap-project
description: >
  Bootstrap a new project from an empty directory to a scaffolded, hardened,
  verified, committed repo by composing official scaffolder CLIs with house
  conventions (mise, hk, linting, AGENTS.md seed) - or retrofit those layers
  onto an existing project. Use whenever the user starts a new project, app,
  service, library, or CLI tool - "new project", "spin up", "scaffold",
  "greenfield", "start a repo", "create an app" - even if they only name a
  framework ("make me a TanStack Start app on Cloudflare"). Also use when the
  user asks to harden an existing repo or bring it up to house standard.
---

# Bootstrap Project

Take a project from empty directory to first green commit: interview briefly,
scaffold with the official CLI, wire the toolchain, harden, verify, seed docs,
commit in coherent units. This skill owns the **sequence and house defaults**;
the knowledge for each layer lives in the skills below - route, don't
duplicate.

## Principle: compose, don't vendor

Scaffolder output churns with every framework release; anything this skill
hardcoded about templates would rot in months. Always run the **official
scaffolder** for the stack and check its current docs at bootstrap time. The
durable content here is the house layer - toolchain, hardening, verification,
commit discipline - which changes rarely. Churny per-stack knowledge lives in
`references/` and is kept honest by the rule at the end of this file.

## Routing - who owns what

| Concern | Owner | This skill |
|---|---|---|
| Which linters/rules per stack, strict tsconfig | `mechanical-enforcement` | invokes it at the harden phase |
| Wiring hooks (`hk.pkl`, mise tasks, prepare) | `hk` | invokes it at the harden phase |
| Seeding the project's own verify skill | `verify` skill | invokes it at the seed phase |
| TS idioms once code exists | `typescript` | points there |
| Test strategy | `testing` | points there |
| Workers Builds, custom domains, Access | `cloudflare-workers-deployments` | invokes it at the deploy phase |
| Cloudflare platform wiring + TanStack Start | `references/cloudflare-tanstack-start.md` | reads it when that's the stack |

`mechanical-enforcement` also triggers on "setting up a new project" - the
split is: it owns *which rules*; this skill owns *when in the sequence* and
everything that isn't a lint rule.

## Phase 0 - Interview

Ask only what is hard to reverse, in one round (skip anything the user's
request already answered):

1. **Stack** - blessed path (Cloudflare) or an entry from the scaffolder table?
2. **Name and location** - default `~/git/<name>`; confirm, don't assume.
3. **Remote repo** - none / private / public?
4. **Deploy now** - or stop at a local green repo?

Everything else takes house defaults silently: pnpm (never npm/npx), mise,
hk, strict linting. The global supply-chain posture (quarantine,
ignore-scripts, trust policy) already applies - never weaken it; if a native
module needs install scripts, ask before allow-listing narrowly.

## The spine

Phases 1-6 are the core. 7-8 run only if the interview asked for them.

### 1. Scaffold

Find the stack's official scaffolder - check current docs rather than memory
(scaffolders churn; TanStack's own CLI has already migrated once). Stable
starting points:

| Stack | Scaffolder |
|---|---|
| Anything on Cloudflare | `pnpm create cloudflare@latest` - read `references/cloudflare-tanstack-start.md` first |
| Vite SPA / frontend | `pnpm create vite` |
| Python | `uv init` |
| Rust | `cargo new` |
| Plain TS library / CLI | `pnpm init` + strict tsconfig from `mechanical-enforcement` |
| zsh function | not a project - follow the dotfiles shell-function conventions instead |

Decline the scaffolder's own deploy/git-push offers - those come later,
deliberately. `git init` if the scaffolder didn't.

### 2. Toolchain

`mise use <runtime>@<version>` to pin runtimes in `mise.toml`; add the package
manager if the project needs a pinned one.

### 3. Harden

Apply `mechanical-enforcement` (pick linters from its stack table, copy its
snippets) and `hk` (compose `hk.pkl` from its tiers, wire hooks via mise).
Keep scaffolder-generated config unless it conflicts with a house rule; when
it does, prefer the house rule and say why in the commit message.

### 4. Verify

Writing config is not enough - prove each layer works:

- Dev server starts, bound to `127.0.0.1` (not `0.0.0.0`).
- Typecheck, lint, and tests all green.
- **The gate gates**: attempt a deliberately bad commit (trailing whitespace,
  a lint error) and confirm hk rejects it. Config that exists but doesn't
  fire is the most common bootstrap failure; this catches it. Clean up after.

### 5. Seed docs

- Write `AGENTS.md` at the repo root from `assets/AGENTS-template.md`. It is
  orientation, not reference: commands (with their traps), where things live,
  conventions code can't show, and links out for everything deeper. Rules a
  linter enforces stay in lint config; keep the empty Gotchas section as the
  landing place for future surprises. Present tense, timeless - no bootstrap
  narrative. Symlink `CLAUDE.md -> AGENTS.md`.
- Invoke the `verify` skill to bootstrap the project's own verify skill - do
  not reimplement it.

### 6. Commit in coherent units

Commit as you go, not one blob at the end:

1. **Pristine scaffold** - the scaffolder's untouched output (keep the
   scaffolder's own initial commit if it made one). This makes every later
   diff reviewable against a known baseline.
2. **Toolchain** - `mise.toml` and friends.
3. **Hardening** - lint config + hk wiring, plus any fixes they forced.
4. **Docs** - `AGENTS.md` and the verify skill.

Stage explicit paths; never `git add -A`.

### 7. Remote repo + CI (optional)

- `gh repo create <name> --private --source . --push` (visibility as answered
  in the interview).
- `mise generate github-action` for CI; use `jdx/mise-action@v4`. CI runs the
  same checks the hooks run - one source of truth.

### 8. First deploy (optional)

Route by target: Cloudflare → the `cloudflare-workers-deployments` skill
(Workers Builds vs local `wrangler deploy`); elsewhere follow the platform's
current docs. End state worth aiming for: a live URL recorded in `AGENTS.md`.

## Retrofit

When the project already exists (scaffolded by the user, an earlier session,
or long ago): skip phase 1, audit which of phases 2-6 are missing, and apply
only those - same order, same per-phase commits. Don't rip out working config
that merely differs in style from house defaults; upgrade what's absent or
broken.

## Keep references honest

The reference files are snapshots of moving targets, and the only moment
their accuracy is tested is now, while you bootstrap. When observed reality
contradicts a reference - a flag changed, generated files differ, a
documented gap has been fixed, you hit an undocumented one - update the
reference to match what you observed before finishing, bump its "Last
verified" line, and flag the edit in your summary. Record only observed,
reproducible differences, never speculation from a one-off failure. Never
stage or commit in the dotfiles repo - the user reviews via `dotfiles diff`.

## Scope guardrails

- **Platform wiring only.** This skill stops where app architecture starts.
  Blessing app-level choices (D1 + ORM, better-auth, Convex) is deliberately
  deferred, not forgotten - it's the fastest-rotting layer and it competes
  with `architecture`/`typescript`. Revisit when a real project has proven a
  pattern worth encoding; it then graduates into a reference file the way
  Cloudflare did.
- **Stacks graduate, tables stay stable.** The scaffolder table holds only
  entries stable for years; anything churny earns its own reference file.
- If a phase proves purely mechanical and identical across runs, extract it
  into `scripts/` rather than re-deriving it in prose each time.
