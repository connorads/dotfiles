<!-- Seed template for the AGENTS.md written at bootstrap. Fill every
     <placeholder>, drop sections that don't apply yet, delete these comments.
     Present tense, timeless - no bootstrap narrative. Symlink
     CLAUDE.md -> AGENTS.md alongside it.

     Altitude rule: this file is orientation, not reference. Anything a
     linter/tsconfig enforces lives in config, not restated here; anything
     reference-depth lives in docs/ or README - link out instead. -->

# <name>

<one sentence: what this is, the stack, where it deploys.> README targets
users; this file is for agents and maintainers working on the repo.

<!-- Only if the repo has ONE load-bearing behavioural rule (data that must
     never be lost, an authorisation gate, a hard "never run X"), state it
     here as `## Golden rule: <rule>`. Otherwise omit - a list of golden
     rules is just a conventions section wearing a crown. -->

## Commands

```bash
<dev command>        # dev server (127.0.0.1:<port>)
<build command>
<test command>
hk check             # lint + format + hook checks
```

<!-- Note command traps inline where they exist ("pnpm run deploy, never
     pnpm deploy"), not just the happy path. -->

## Layout

<where things live, 3-6 lines: the seams an agent needs - routes, domain,
adapters, generated-vs-authored. Never a file-by-file inventory; it shadows
the tree and rots.>

## Conventions

<only what code and config cannot show. Where a convention IS mechanically
enforced, say so and by what ("determinism in core/ - eslint-enforced") so
agents know it's a gate, not advice. Rules that live in lint config do not
get restated here.>

## Gotchas

<empty at bootstrap - keep the section anyway; it is the landing place for
non-obvious traps as they are hit, especially looks-green-but-broken
failures. A lead sentence per entry; if one outgrows a few lines, move it to
docs/ and link.>

## Deploy

<live URL, how to verify the deployed thing actually works, and the secrets
inventory by name only (e.g. the `wrangler secret list` names - never
values, and note which vars are plaintext config rather than secrets). Omit
the section until first deploy.>

## Deeper docs

<links out: README, docs/adr/, PRD/CONTEXT where they exist. Decisions and
reference-depth material live there, not here - this deferral is what keeps
the file short.>
