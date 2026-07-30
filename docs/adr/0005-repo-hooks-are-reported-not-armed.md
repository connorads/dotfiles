# A repo's own git hooks are reported, never armed automatically

`git hooks status` ([`.config/zsh/functions/git/git-hooks`](../../.config/zsh/functions/git/git-hooks))
names, per repo, which hook managers are declared, which are actually armed, and
by which mechanism. `rs` calls it with `--quiet` at the end of repo setup.

It arms nothing. Wiring a repo's hooks stays a hand-typed command, because that
is the moment a reviewer would otherwise never get.

## Context

Global `ignore-scripts=true` in `~/.npmrc` (and `ignoreScripts: true` for pnpm)
blocks a project's own `prepare` script, which is how husky and hk wire
themselves at install time. Nine repos under `~/git` therefore declare hooks that
have never run: `alchemy-cf-app`, `bhff-wordpress`,
`ds-skill-extraction-workshop`, `fackas`, `fittr-dashboard-app`,
`freeagent-mcp`, `kc`, `moth`, `pi-mono`. Nothing said so - `git commit`
succeeded, the lint step declared in the repo simply did not exist.

The same silence covered the other direction. The identity guard was copied into
each new repo by `init.templateDir` as a symlink into the nix store, so 14 repos
held a dangling link that git skipped without a word, and it never applied at all
in the ~20 repos that set `core.hooksPath`. Both failures share a shape: hook
state is invisible, so being wrong about it costs nothing until it matters.

Arming is a different kind of act from reporting. A repo's hook file is arbitrary
code that runs on every subsequent commit, edited by whoever last touched the
branch. `git clone` followed by an automatic arm makes that a decision nobody
made.

## Decision

Split the two: make hook state **visible** now, keep **arming** a separate,
deliberate command (`git hooks arm`, not yet written).

`git hook list <event> --show-scope` (git >= 2.54) is the authority for what
fires, because it knows both mechanisms - directory hooks and config hooks - and
skips a dangling symlink. It is not sufficient on its own: a directory hook comes
back as the opaque string `hook from hookdir`, with no path and no scope, so
naming the manager needs separate detection.

That detection reads the hookdir *path* before the hook file's contents, because
a generated hook need not name its manager: husky's `.husky/_/pre-commit` is two
lines sourcing `h`, and a tracked hk wrapper reaches hk through `$HK_BIN`. Both
were misattributed to "unrecognised manager" by a contents-only first cut.

Support is decided by version, not by probing. `git hook list <event>` exits 1
with *"no hooks found for event"* when a repo simply has none, which is
indistinguishable from an unsupported subcommand - reading that as unsupported
downgraded the report to "armed state unknown" for exactly the repos the tool
exists to flag.

`rs` calls `git hooks status --quiet`: report-only, silent when nothing is
actionable, silent in CI, and absent-tool-tolerant. Plain `status` always exits
0, so it can never break a setup run; `--check` is the opt-in failure mode.

## Alternatives considered

- **`hk install --global`** (or per-repo `prepare` wiring, i.e. undoing
  `ignore-scripts`). Rejected: it makes `git clone` arm code execution for every
  later commit in that repo, with no notice when someone edits the hook in a PR.
  The nine unarmed repos are mostly other people's, which is the case the global
  version is worst for.

- **Per-repo `.npmrc` with `ignore-scripts=false`.** Rejected: npm has no
  per-package allow-list, so it re-enables lifecycle scripts for the entire
  dependency graph in order to run one `prepare` - the whole vector back, for a
  hook. pnpm's `allowBuilds` can do this narrowly; npm cannot, and the unarmed
  repos are npm ones.

- **`hook.<event>.enabled=false` as a global default-deny**, then opting repos in.
  Elegant, and would make arming explicit by construction. Rejected on
  mechanism: the key overrides per-hook settings, so it would also disable the
  identity guard in every repo not yet opted in - trading a silent-no-hooks
  problem for a silent-no-guard one. Kept in mind as a panic switch.

- **Running installs in a sandbox** so `prepare` can be allowed safely. Rejected
  as buying little here: an install needs network and writes into the project, so
  the containment boundary would have to include the two things that matter, and
  the hook it wires still runs unsandboxed at every later commit.

- **CI-only checks, no local hooks at all.** Defensible for lint, and rejected as
  a general answer: the declared hooks here also do codegen and patch steps whose
  absence is only discovered later, and a repo's CI is not always ours to change.
  It also does nothing about the guard, which has to run before a commit object
  exists.

- **Reporting inside `hk` or a git alias instead of a new command.** Rejected:
  `hk` is one of the five managers being reported on, and the interesting repos
  are the ones where it is not installed. A dual-mode function on `PATH` also
  gives `git hooks` for free, and works from an agent's bash subprocess.

## Known limits

- Manager attribution is heuristic where the mechanism is not: five managers
  spell their event lists five ways, so declared *events* come from substring
  matching on the config file. What actually fires never depends on that.
- `simple-git-hooks` detection is untested against a real repo - none exists here
  to check against, only its documented file names.
- Only `pre-commit`, `commit-msg` and `pre-push` are inspected. A repo wiring
  `post-merge` or `prepare-commit-msg` reads as declaring nothing.
- Stale `.git/hooks/pre-commit` stubs (26 here, 14 of them dangling) are reported
  and deliberately left in place: the live ones exec the same guard, so a
  double-fire is harmless, and git already skips the dangling ones.
