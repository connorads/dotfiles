# hk gates

What each dotfiles pre-commit gate does and why. Config: [`~/hk.pkl`](../hk.pkl).

Dotfiles commit hooks are tracked in `~/.hk-hooks/` and configured via:

```bash
dotfiles config core.hooksPath .hk-hooks
```

The pre-commit hook runs `hk run pre-commit -q` using `hk.pkl` at `~/hk.pkl`
(`-q`, hk >= 1.51.0: success is silent, step chatter only surfaces on failure).
The `amends`/`import` pin in `hk.pkl` and the mise-installed binary must name
the same version - both are 1.56.1. The pin decides which builtins exist; the
binary decides what understands them, and a mismatch makes builtin steps fail
with `no command for test` rather than saying so.

There is no `.local` exclude. It hid 128 tracked entries - 6 first-party
scripts on PATH plus the 122 `zfn-link` shims - from every gate, and the
untracked mise/pnpm trees under `.local/share` and `.local/state` were never in
scope anyway: `hk --all` selects tracked files, and the staged path sees only
what git tracks. What each gate covers, and the candidates that were rejected
with the evidence against them, is
[docs/adr/0007](../docs/adr/0007-what-hk-gates-and-what-it-does-not.md).

Builtin gates include `typos` (spell check, default locale so both en variants
pass; config + false-positive allow-list in `~/.typos.toml`), `actionlint` and
`zizmor` (GitHub workflow correctness + security; zizmor runs `--offline` at
commit time), `fix-smart-quotes` (curly quotes in prose; vendored mirrors and
summon's verbatim quote collections excluded), `deadnix` (dead code in the nix
tree - an unused binding or lambda argument evaluates fine, so `nix-eval` can
never see one), `check-symlinks` (the `.local/bin` shims: renaming a function
without re-running `zfn-link` leaves a dangling one on PATH, and interactive
autoload keeps working so nothing says so), `check-case-conflict` (two paths
differing only in case are one file on macOS and two on the four Linux hosts),
plus the formatters/linters (shfmt, shellcheck, rumdl for markdown lint,
`rumdl-format` for its formatting half, nixfmt...).

The `hk-test` step runs the steps' own `tests {}` blocks whenever `hk.pkl` is
staged. Gates fail **open** here - a glob matching nothing exits 0 - so
`gate-coverage.py` asserts the wiring still points at real paths and this
asserts the checkers still reject what they exist to reject. It strips
`GIT_DIR`/`GIT_WORK_TREE`: `Builtins.actionlint`'s bundled tests run
`before = "git init"`, and with the bare-repo split exported that addresses
`~/git/dotfiles` itself.

The `vale` step gates the house prose rules that a regex can express (config
`~/.vale.ini`, style `.config/vale/styles/Connorads`). It runs `--no-global` so
only the tracked style can block a commit, and it drops the builtin's
`vale sync`: that fetches remote style packages, which would put a network call
in the pre-commit path. Vale skips fenced blocks and code spans natively, so a
dash in a command or a diagram is never touched. `prose` is the advisory twin,
callable from any repo.

The style is named `Connorads`, not `House`, so it cannot shadow a client repo's
own `House` style through the global styles dir. Every rule carries
`level: error`; without it the rule is a silent no-op under
`MinAlertLevel = error`.

Scope is markdown **and code comments**: `~/.vale.ini` carries two format
sections, and both are `BasedOnStyles = Connorads`, so the same rules apply to a
comment as to a doc. `.py .ts .tsx .js .jsx .rs .go .rb .lua` are the source
half, and that extension list is Vale's, not a preference - for anything else
Vale lints the whole file as prose, so a string literal would be gated as
English. Three limits worth knowing: `.mjs`/`.cjs`/`.mts`/`.cts` cannot be
brought in (`[formats] mjs = js` parses and then reports zero findings, a silent
fail-open); neither can shell, which leaves the tree's largest comment corpus
ungated; and Vale extracts Python `#` comments but not docstrings. Only
`Connorads` is based on - adding the built-in `Vale` style would bring its
error-level Spelling rule, which reads an identifier in a comment as a typo.

Custom steps include `nix-eval` (`~/.hk-hooks/nix-eval.sh`: evaluates every
host configuration's `.drvPath` - 2 darwin, 4 home-manager - whenever
`.config/nix/**` is staged, so a config authored on one host can't silently
break another; ~25s, skippable with `HK_SKIP_STEPS=nix-eval`), `statix`
(`~/.hk-hooks/statix.sh`: nix anti-patterns, one staged file per call because
statix takes a single target; `--config .hk-hooks/statix.toml` keeps it a gate
config rather than the global default, and `repeated_keys` is disabled there -
it wants flat nix-darwin/home-manager attributes collapsed into nested sets,
which buries the option name the manual uses), `link-check`
(`~/.hk-hooks/link-check.sh`: lychee `--offline` over tracked markdown, ~0.1s
whole-tree; **globless on purpose** - link rot comes from deleting a target, and
hk never runs a globbed step when the only staged change is a deletion),
`zsh-fn-header` (shell-function header + shebang/`# zsh-only:` conventions),
`skills-no-local-paths` (`~/.hk-hooks/skills-no-local-paths.sh`: the authored
skill tiers `skills/` and `.config/skills/personal/` are public, so no file in
them may name a path on this machine - `~/git/<repo>`, `/Users/<user>/`;
angle-bracket placeholders and the generic users me/you/alice/bob pass; a
worked example is embedded, never pointed at),
`oxlint`
(first-party JS/TS, correctness **and type-aware** rules, `--deny-warnings`;
vendored skills and eval-fixture/reference snippets excluded - see the
type-aware section below), `ruff-check` +
`ruff-format` (first-party Python lint + format, rule set `E,F,UP,B,SIM,I,RUF`;
config `.hk-hooks/ruff.toml` passed with `--config` so it gates without becoming
the global XDG default; same vendored/fixture exclude set as oxlint;
`ruff-format` runs after `ruff-check` so import fixes land before the final
formatter pass), and `quarantine-drift`
(`~/.hk-hooks/quarantine-drift.py`: the 4-day quarantine is hand-spelled in
nine config files across four time units; the checker normalises each to days
and blocks the commit on disagreement, with warn-only staleness checks on the
docs that cite literal values), and `tmux-bind-lint`
(`~/.hk-hooks/tmux-bind-lint.py`: statically parses `.config/tmux/tmux.conf` and
blocks a key bound twice in one key-table, or both members of a terminal-alias
pair, i.e. a self-collision that silently kills the earlier bind - the
commit-time complement to the edit-time `tmux-freekeys` advisor).

The `bash5-preamble` step (`~/.hk-hooks/bash5-preamble.py`) keeps the tmux
shell glue from depending on which bash the caller's PATH supplies - macOS
hands `run-shell` the 2007-era `/bin/bash`, with no `mapfile` and no
`declare -A`. Three assertions over `.config/tmux/{scripts,strategies,save_command_strategies}`:
an executable `env bash` entry point must carry the re-exec preamble, anything
under `scripts/lib/` must carry the `bash >= 5` assert instead (you cannot
`exec` a sourced file), and an `sh`-shebang file must carry neither. It keys on
the **shebang, not the `.sh` extension**. Rationale and rejected alternatives:
[docs/adr/0001](../docs/adr/0001-tmux-scripts-re-exec-under-bash-5.md); the
subsystem contract is in [.config/tmux/AGENTS.md](../.config/tmux/AGENTS.md).

The `skill-tests` step runs colocated skill-script tests (pytest via uv /
bats under `<skill>/tests/`) for whichever authored skills the staged files
touch; the shared `~/.hk-hooks/skill-tests.sh` warns and exits 0 when a
runner is absent, and `mise run skill-checks` runs every suite across all
tiers (private included).

The `ts-typecheck-*` steps gate first-party TS projects (skl, pin-audit,
annotate, opencode-plugins, `.config/opencode`, pi goal / workflows /
pi-palette / agent-guard, and the small pi extensions) with
the global `tsc` (typescript 7),
glob-scoped so only staged-project changes pay the cost. The shared
`~/.hk-hooks/ts-typecheck.sh` warns and exits 0 when a project's
`node_modules` is absent (fresh/offline machines); `mise run ts-checks`
installs deps and runs typecheck + tests across all of them.

`.config/opencode` is a **typecheck-only bun project**, and the one whose
manifest is also an interface: opencode's docs say to author a `package.json` in
the config dir and that opencode runs `bun install` on it at startup, so the file
is taken over rather than replaced (ADR 0006). Every `@opencode-ai/*` import
across all six plugins is `import type`, so the deps are devDependencies and no
plugin needs a package to run. It declares no `test` script, which is why
`ts-tests.sh` skips it. Two SDK event surfaces matter when editing the plugins:
the root `@opencode-ai/sdk` export is v1 and has no `permission.asked`,
`question.*` or `global.disposed`, while `@opencode-ai/sdk/v2/types` has all of
them. `plugin/*` deliberately handles names from both so it survives either
opencode version, so its event parameters are typed as the union - narrowing to
v1 alone turns every v2 case into a "no overlap" error, and deleting those cases
breaks the plugin.

Type-aware oxlint is configured in **`~/.oxlintrc.json`**, the tree's only
oxlint config, which therefore governs every oxlint run in the work-tree
(nested discovery stays on, so a per-project config would merge over it).
`options.typeAware` is used rather than the `--type-aware` flag so the rules
hold for the editor and for any wrapper that drops argv. The rules live in a
separate binary oxlint shells out to - `npm:oxlint-tsgolint`, whose bin is named
`tsgolint`, so `mise which oxlint-tsgolint` errors while `mise which tsgolint`
resolves. oxlint and tsgolint are a **drift pair**: pinned independently, bumped
independently by `up`, and tsgolint's version line tracks typescript-go rather
than oxlint, so the majors never agree and a skew turns the rules off rather
than failing loudly.

A type-aware rule needs project membership and **degrades silently without it**:
a file inside a tsconfig `include` catches an unawaited `writeFile()`, and the
same file outside one misses it with no error and no warning. So the cost of an
unrooted first-party dir is false negatives, which is why every first-party TS
dir carries a tsconfig. `skills/**/*.mjs` stays unrooted (plain JS, where
type-aware buys little) - and there the declaration-form JSDoc
`/** @type {...} */` above a `const` is **ignored**, while the inline-cast form
`= /** @type {...} */ (value)` is honoured. Use the inline form in any file that
belongs to no tsconfig.

`no-floating-promises` carries `allowForKnownSafeCalls` for `test`/`it`/
`describe` from `node:test`: the runner awaits its own `test(...)` promise, and
those calls were 192 of the 209 findings. The rule stays live inside test
bodies, where an unawaited promise is a real bug.

The `ts-tests-scoped` step runs those projects' test suites at commit time,
via `~/.hk-hooks/ts-tests.sh`. It is one **discovering** step rather than one
per project: each staged file resolves to its nearest `package.json`, and that
project's `test` script runs under the package manager its lockfile names
(`bun.lock` → `bun run test`, `pnpm-lock.yaml` → `pnpm run test`), so
`node --test`, `vitest` and `bun test` all dispatch through one gate and a new
project is covered the day it exists. Enumeration is what left `agent-guard`
ungated for its whole life. Latency is affordable because the gate assumes
`node_modules` is present - the slow half of `mise run ts-checks` is its
frozen-lockfile installs, not the tests. Missing `jq`, runner or `node_modules`
warns and exits 0, same never-brick posture as `ts-typecheck.sh`;
`bash ~/.hk-hooks/ts-tests.sh --all` (what `ts-checks` calls) is the full run,
and `~/.config/zsh/tests/ts-tests.bats` pins the gate's own contract. The three
discovery roots are spelled in both `hk.pkl`'s glob and the script; the
`gate-coverage` step asserts the two agree.

The `py-typecheck-*` steps are the Python analogue: `pyrefly` (`preset =
"strict"`, invoked with `-c`) gates the four script dirs (`.claude/hooks`,
`.hk-hooks`, `.config/vox`, `.config/tmux`) and `src/handoff`, one glob-scoped
step per root with a per-root `pyrefly.toml` (each root its own project so
intra-package imports resolve). What is gated is decided by import
resolvability, not by directory: a file importing an uninstalled third-party
dep would be `missing-import` noise, so most tmux and skill scripts stay out,
and in `.config/tmux` the `pyrefly.toml` names
[`fzf_link_paths.py`](../.config/tmux/fzf_link_paths.py) alone - its adapter
`user_schemes.py` imports `tmux_fzf_links`, which resolves only beside the
gitignored plugin checkout. That split is why the path logic lives in a
plugin-free file at all. The shared `~/.hk-hooks/py-typecheck.sh` warns and
exits 0 when `pyrefly` is absent.

The `py-tests-scoped` step is the Python `ts-tests-scoped`: each staged file
resolves to its nearest `pyproject.toml` and `~/.hk-hooks/py-tests.sh` runs that
project's pytest under its own uv env with `-c pyproject.toml` (a stray
`tests/pytest.ini` would otherwise become the config and silently drop every
`strict_*` key), then `lint-imports --no-cache` and `deptry` where the
pyproject declares them. `gate-coverage` distinguishes a packaged project
(`pyproject.toml`) from a flat script dir (`pyrefly.toml` only): the former must
be in this step's glob and the script's `ROOTS`, both need a `py-typecheck-*`
step. The script dirs carry a `pytest.ini` with the plugin-free strictness
(`strict_markers`, `strict_config`, `strict_xfail`, `empty_parameter_set_mark`,
`filterwarnings = error`) and run from `mise run py-checks`, which also calls
`py-tests.sh --all`. Missing `uv` warns and exits 0; the gate's own contract is
`~/.config/zsh/tests/py-tests.bats`.

A flat script dir has no `pyproject.toml` for that step to discover, so its
suite is reached by naming the dir instead: `py-tests-dir.sh <root>` runs
`uv run --with pytest python -m pytest` there, the same invocation `py-checks`
uses. `py-tests-tmux` is the one step wired to it - the fzf-links path core
decides which file `prefix + u` opens, and being pure it needs nothing but
`uv`. The other script dirs still run only from `mise run py-checks`; add a
step per dir if that stops being enough.

The `bats-scoped` step (pre-commit) gates the zsh bats suite
(`~/.config/zsh/tests`, 115 files) via `~/.hk-hooks/bats-tests.sh`, running only
the suites the staged files touch - a staged `*.bats` runs itself, a staged
script under `.config/zsh/functions/**` or `.config/tmux/scripts/**` runs the
suite named after it plus any suite that names it. `bats` absent warns and exits
0, same never-brick posture as `ts-typecheck.sh`. The gate exists because
nothing ran the suite before: CI is PR-only and commits land through the hook,
so four suites rotted unnoticed. Conventions and the meaning of the
`integration` tag: [.config/zsh/tests/AGENTS.md](../.config/zsh/tests/AGENTS.md).

**There is deliberately no pre-push gate.** `git push` opens the connection and
fetches remote refs *before* running `pre-push` (the hook needs them on stdin),
so a whole-suite run holds that connection idle for its full duration and GitHub
closes it - the push then fails with `Connection to github.com closed by remote
host`, and `--no-verify` is the only way through. The suite is ~2min idle but
several times that under load, which is exactly when a push is likeliest to be
attempted. Run the whole suite by hand with `mise run zsh-tests`.

CI (`.github/workflows/check.yml`) is PR-only: one ubuntu job runs
`hk check --all` - the same gate as the hook, full-tree - plus manual dispatch.
Nothing runs on push; local commits are already gated by pre-commit.
`.github/dependabot.yml` bumps the SHA-pinned actions weekly with a 7-day
cooldown (the Actions arm of the release-age quarantine).
