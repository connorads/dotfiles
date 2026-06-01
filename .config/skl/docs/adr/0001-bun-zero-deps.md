# Bun + TypeScript with zero external dependencies for `skl`

`skl` (the deliberate skill loader) is built on Bun with native TypeScript and **no npm
dependencies** — using `Bun.file`, `Bun.spawn`, `Bun.Glob`, and `Bun.YAML.parse` instead.
This deviates from the dotfiles' usual zsh-function convention and from the global rule
"only use bun if the project already uses it"; both are deliberate here.

## Considered options

- **zsh dual-mode function** (the established convention): rejected — parsing SKILL.md
  frontmatter in shell is fiddly, and there's no shell test harness, which fights the
  required typed-core + tests discipline.
- **Deno + TypeScript**: a strong fit (native TS, built-in test runner, permissions
  model). Rejected narrowly in favour of Bun for faster popup startup, `bun build
  --compile` packaging, and existing `.bunfig.toml` quarantine config.
- **Node (+ tsx/vitest)**: viable, but TS-without-a-build is rougher and the tooling
  pulls in npm deps — supply-chain surface this setup works hard to minimise.

## Consequences

- A tmux popup wants snappy startup; Bun is fastest and TS needs no build step.
- **Zero npm deps = zero supply-chain surface**, aligning with the repo's aube/pnpm
  quarantine and `ignore-scripts` posture. The cost is relying on Bun-specific APIs
  (notably `Bun.YAML.parse`), which couples the tool to Bun — acceptable for a personal
  tool that may later graduate to its own package (`bun build --compile`).
- This is greenfield, so opting into Bun does not violate the *spirit* of the
  "don't drag bun into an existing node project" rule.
