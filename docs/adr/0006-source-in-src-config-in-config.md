# Source lives in `~/src`, config lives in `~/.config`

One question decides where a thing lives:

> Does a consumer I don't control read that path?
>
> - **Yes** -> `.config/` (or the dot-dir the tool names). The path is the interface.
> - **No**, and it has its own manifest or test suite -> `~/src/<name>/`.
>
> Where a tool has both, split them: source in `src/`, config and state in `.config/`.

[`~/src/pin-audit`](../../src/pin-audit) is the worked example: TypeScript
implementation under `src/`, a thin dual-mode zsh wrapper at
`.config/zsh/functions/nix/pin-audit`, a `zfn-link` symlink on `PATH`, and its
CLI-contract suite in `.config/zsh/tests/pin-audit.bats`.

## Context

`.config` accumulated things that are not configuration. `skl` is a Bun CLI with
its own `package.json`, `bun.lock`, `tsconfig.json`, nine ADRs and colocated
tests - a project by every measure - while its own Raycast wrapper already lives
at `src/raycast/skl`, reaching back across the tree into a dot-dir for its own
implementation.

The cost is not aesthetic. A tool split across `.config` and `src` is read by
whichever gate happens to name each half, and the gates key on hard-coded path
prefixes.

## Decision

Sort by **who reads the path**, not by what the file contains. `init.lua`,
`hk.pkl` and `opencode.json` are all code, and all stay in `.config`, because
nvim, hk and opencode go looking for them there.

Some tools cannot be split, because the path is load-bearing:

| Path | Why it cannot move |
|---|---|
| `.pi/agent/extensions` | pi composes the dir as `join(<agent dir>, "extensions")` (`dist/core/resource-loader.js`, `dist/core/package-manager.js`). `settings.json`'s `extensions` key is a `string[]` of enable/disable patterns, not a search path. Only `PI_CODING_AGENT_DIR` relocates it, and that drags auth and sessions with it. |
| `.config/nix/{voxtap,biokc,imagepaste}` | `${../voxtap/main.swift}` is a path literal resolved against the flake root, and nix copies only the flake dir into the store. A `~/src` path fails under pure eval. |
| `.hk-hooks` | `core.hooksPath` is set to `.hk-hooks`. |
| `.claude/hooks` | Six scripts named by absolute path in `.claude/settings.json`. |
| `.config/opencode/plugin` | Directory convention. `opencode.json`'s `plugin` array takes npm refs. |

Moving code between the two trees is safe only once `mise run gate-coverage`
passes, because hk steps fail **open**: a glob that matches nothing exits 0, so a
gate that stops covering its project goes quiet rather than failing the commit.

## Consequences

A move is never one `git mv`. Relocating a project means updating the
`ts-typecheck-*` step, the `ts-tests-scoped` glob *and* `ts-tests.sh`'s `ROOTS`,
the `bats-scoped` glob *and* a `bats-tests.sh` case arm where a bats suite
exists, the `mise` checks, and a `.gitignore` un-ignore block. That list is what
`gate-coverage` asserts, so the compiler for this rule is the checker, not the
reader.

## Alternatives considered

- **Sort by "is it code".** Rejected on the same evidence that motivates the
  rule: `init.lua`, `hk.pkl`, `opencode.json`, every zsh function and every tmux
  script are code, and every one of them must stay where its tool looks. The
  predicate does not discriminate between the thing to move and the thing that
  cannot.

- **Move everything project-shaped, including `.pi/agent/extensions`.** Rejected
  on mechanism: pi builds the path from its agent dir, and the `extensions`
  settings key filters what loads rather than saying where to look. The only
  lever is `PI_CODING_AGENT_DIR`, which relocates auth and session state too -
  a much larger blast radius than a tidier tree is worth.

- **Move the Swift sources out of `.config/nix`.** Rejected: `${../voxtap/main.swift}`
  resolves inside the flake root and nothing outside it is copied to the store,
  so the derivation stops evaluating. The alternative is a second flake or a
  fetcher for three single-file CLIs.

- **State the rule and rely on review.** Already tried, and already failed. The
  invariant was written twice - in `ts-tests.sh`'s comment and in `AGENTS.md` -
  and `bats-scoped` still shipped without the `src/pin-audit` root its own case
  arm depends on. The arm was unreachable at commit time for its whole life.

- **One project registry that `hk.pkl`, `bats-tests.sh` and `mise` all read.**
  Rejected on cost: `hk.pkl` keeps one narrow glob per project deliberately, so
  only a staged project pays for its own gate. A shared registry either
  re-broadens those globs or needs three separate readers in three languages.
  `ts-tests.sh` shows the cheaper shape - discovery inside one gate, asserted
  from outside by `gate-coverage`.

- **Leave the layout alone and index it in the docs.** Rejected: an index
  describes the straddle rather than resolving it, and `skl` would still be a
  project in `.config` whose own wrapper reaches back three levels.

## Known limits

- `vox` is the strongest case for the rule and the one left undone: 21 files
  across 5 locations, ~57 hard-coded literals in 26 test files with no
  `TMUX_SCRIPTS_DIR` indirection, 3 absolute `tmux.conf` bindings, and a Swift
  half that cannot move at all. The prerequisite is a `TMUX_SCRIPTS_DIR` seam in
  `.config/zsh/tests/test_helper.bash`, mirroring `FUNCTIONS_DIR`.
- `gate-coverage` asserts the gates agree with the tree, not that a gate is
  worth having. A project listed in its `UNGATED` table is exempt by decision;
  the table records the reason, and nothing checks that the reason is still true.
