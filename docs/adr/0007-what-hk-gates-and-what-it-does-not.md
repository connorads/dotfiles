# What the hk pipeline gates, and what it deliberately does not

The pre-commit pipeline gates shell, Python, TypeScript, Nix, Markdown style,
workflow security, links, symlinks, secrets, and its own steps. It does not gate
YAML, TOML, pkl, JSON formatting, or action-ref pinning.

Reviewing hk's 150 builtins against this tree turned up more candidates than
survived. This record holds the ones that lost, with the evidence that killed
each, so the list is not re-derived from the builtin index every time someone
reads it.

## Context

Two properties make "should we add this gate?" harder here than the question
sounds.

**Gates fail open.** A step whose glob matches nothing exits 0. So a gate that
has stopped covering its subject is indistinguishable from a clean tree, and
`.hk-hooks/gate-coverage.py` exists because that failure is silent. A candidate
that would mostly no-op is not free: it is a step that looks like coverage and
is not.

**Commit time is offline and cheap.** `zizmor` runs `--offline` deliberately;
`nix-eval` at ~30s is the outlier and carries an escape hatch. A candidate that
needs the network, or that costs seconds on every commit, has to earn it against
CI instead - where `.github/workflows/check.yml` already runs `hk check --all`
on every PR.

## Decision

Add: `deadnix`, `statix`, `lychee` (via `.hk-hooks/link-check.sh`),
`check_symlinks`, `check_case_conflict`, `hk_test`. Drop `.local` from `exclude`,
which had been hiding 128 tracked entries.

Reject the rest, per the reasons below. Revisit only on new evidence, not on a
fresh reading of the builtin list.

## Alternatives considered

**`pinact` for GitHub action-ref pinning.** Rejected: it resolves every ref
through the GitHub API (`/repos/<owner>/<repo>/commits/<ref>`) and has no
offline mode. Measured on 3.10.1: with the API unreachable it exits 1 with
`failed to handle a line: get a reference`, the same exit code it gives for a
genuinely unpinned action - so an offline commit is indistinguishable from a
real finding. That contradicts the `zizmor --offline` posture directly. The job
is already done elsewhere: dependabot bumps the SHA-pinned actions weekly, and
`zizmor`'s `unpinned-uses` audit flags an unpinned ref offline.

**`nil` and `nixf-diagnose` for Nix diagnostics.** Rejected: on this tree both
are strict subsets of `deadnix`. They find the same unused bindings and nothing
`deadnix` misses, so a second Nix linter buys a second process per commit and no
finding. `statix` earns its place because it covers a disjoint class -
anti-patterns (`{ ... }:` that should be `_`, `x = pkgs.x` that should be
`inherit (pkgs) x`), not dead code.

**`lychee` over `src/dotfiles-docs`.** Rejected for that directory only, and
this is why the step's exclusions live in the script rather than being an
oversight. Astro serves extensionless routes (`/trust/supply-chain/`), which no
filesystem resolver can follow: lychee reports all 40 as broken while every
target exists, and `--root-dir` does not help. `starlight-links-validator` in
`astro.config.mjs` checks them at build, where the route table is known.
Vendored Markdown is excluded for the opposite reason - its 15 broken links are
real, and upstream's to fix.

**A `jq`-based JSON gate.** Rejected: of 155 tracked `.json` files, three are
actually JSONC and `jq` refuses to parse them at all
(`.config/zed/keymap.json`, `.config/zed/settings.json`,
`.pi/agent/extensions/workflows/tsconfig.json`), while a `jq .` formatting gate
would rewrite 85 of the rest - `.claude/settings.json` among them, whose own
clean filter already owns its shape. The cost is a large mechanical diff plus a
permanent extension-lies-about-content exclusion list, against no defect anyone
has hit.

**YAML (`yamllint`), TOML (`taplo`), and pkl gates.** Rejected: each finds
nothing on the current tree. Adding a step that no-ops today is adding a gate
that fails open tomorrow with nobody the wiser. The trigger to revisit is a
real defect in one of those formats, not their absence from the pipeline.

**A pre-push hook for the whole test suite.** Rejected, and this one is a
mechanism rather than a preference. `git push` opens the connection and fetches
remote refs *before* running `pre-push` - the hook needs them on stdin - so a
whole-suite run holds that connection idle for its full duration and GitHub
closes it: `Connection to github.com closed by remote host`, with `--no-verify`
the only way through. The suite is ~2min idle and several times that under load,
which is exactly when a push is likeliest. `mise run zsh-tests` stays manual.

**Upgrading the hk pkl pin to get more builtins.** Rejected for now, separately
scoped. Every builtin this work needs - `deadnix`, `lychee`, `check_symlinks`,
`check_case_conflict`, `hk_test` - was already present at 1.51.0, the pin this
decision was written against. `statix` is a builtin at neither that version nor
the current pin, which is why it is a custom step rather than a reason to move
the pin.

## Consequences

The builtin set is tied to the version in `hk.pkl`'s `amends`/`import` URL, not
to whatever `hk` is installed. Check that tag's `pkl/builtins/` before reaching
for a builtin named in current docs.

`Builtins.hk_test` activates every builtin's own bundled tests, not just
authored ones. Thirteen failed on contact here: some describe an unscoped
builtin this repo narrowed, others pin a tool version's behaviour that the
pinned release does not have. Each is replaced or dropped at the step, with the
reason inline.

Two exclusions are load-bearing and will look arbitrary without this record:
`link-check.sh` skipping `src/dotfiles-docs`, and `statix.toml` disabling
`repeated_keys`. Both are documented at the point of use as well.
