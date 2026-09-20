---
name: hk
description: Set up and maintain hk git hook manager in any repository. Use when adding pre-commit hooks, configuring linters, setting up code quality automation, working with hk.pkl, or maintaining existing hook configurations. Triggers on tasks involving hk, git hooks, pre-commit checks, commit-msg validation, or linting pipelines.
---

# hk - Git Hook Manager

[hk](https://hk.jdx.dev) runs linters and formatters as git hooks. It coordinates
file access and isolates staged changes when stashing is enabled. Configuration
is Pkl. Commands still need accurate file selection and declared effects.

## Mental Model

Detect the repository's version and hook contract before composing steps or
wiring hooks. A maintenance task preserves that contract unless the user asks
to change it.

## Setup Workflow

### 1. Detect

```bash
hk --version                    # compare with the repo pin and schema URLs
ls package.json go.mod Cargo.toml pyproject.toml flake.nix Makefile
cat mise.toml package.json      # existing tools, package manager, scripts
```

For new setups use hk v2. For existing setups inspect the tool pin and lockfile,
`hk.pkl` imports, local overrides and `git config --show-origin core.hooksPath`.
Resolve version mismatches before editing; do not silently upgrade the repo.
For v1 maintenance or any major upgrade, read `references/versions-and-migration.md`.
Preserve hook membership, staging expectations and secret-scanning scope.

Identify:

- Language(s) and framework
- Package manager (pnpm/bun/npm/yarn for JS, cargo, go, pip, etc.)
- Formatter already configured (prettier, biome, ruff, gofmt…)
- Linter already configured (eslint, golangci-lint, ruff, clippy…)
- Test runner (vitest, jest, go test, cargo test, pytest…)
- Whether it's a team/shared repo, and whether branch protection should be hard
  server-side protection or advisory local hook protection

### 2. Choose steps (tiered)

**Tier 1 - Universal (always add):**

| Step | Builtin |
|------|---------|
| trailing-whitespace | `Builtins.trailing_whitespace` |
| newlines | `Builtins.newlines` |
| check-merge-conflict | `Builtins.check_merge_conflict` |

**Tier 2 - Common tools (add if relevant):**

| Step | Builtin | When |
|------|---------|------|
| typos | `Builtins.typos` | Always (fast spell check) |
| gitleaks | custom | Always (secret detection) |
| rumdl | `Builtins.rumdl` | If `*.md` files exist |

**Tier 3 - Language-specific** (see `references/builtins-by-language.md`):

| Signal file | Steps to add |
|------------|-------------|
| `package.json` + `biome.json`/`biome.jsonc` | biome (or ultracite), eslint |
| `package.json` (no biome) | prettier, eslint |
| `tsconfig.json` | typecheck (tsc/tsgo/astro check/svelte-check) |
| `go.mod` | go_fmt, go_vet, golangci_lint, gomod_tidy |
| `Cargo.toml` | cargo_fmt, cargo_clippy |
| `pyproject.toml`/`requirements.txt` | ruff (format+lint), mypy |
| `flake.nix`/`*.nix` | nix_fmt (nixfmt), deadnix |
| `*.sh`/`*.zsh` | shfmt, shellcheck |

**Tier 4 - Project-specific (detect from config files):**

| Signal | Step |
|--------|------|
| `commitlint.config.*` exists | commit-msg hook with commitlint |
| `.dependency-cruiser.*` or `check:deps` exists | whole-graph architecture check |
| `.yamllint*` exists | yamllint |
| Team/shared repo | no-commit-to-branch (pre-commit), branch guard (pre-push). For advisory private-repo protection with owner opt-out, use the soft-protected pre-push asset below. |
| `pnpm-lock.yaml` exists | pnpm build-script decision check - copy `assets/pnpm-build-scripts-check.mjs` (see below) |
| Test runner detected | test step(s) - vitest/jest/go test/cargo test/pytest |

### 3. Wire the hooks

Three files to create/update, plus optional extras:

1. `mise.toml` - add hk and tool binaries; v2 embeds its Pkl evaluator
2. `hk.pkl` - configuration
3. `.hk-hooks/pre-commit` - tracked hook wrapper (runs `hk run pre-commit -q`; `-q` quiets every step on success - see `references/output-noise.md`)
4. `.hk-hooks/pre-push` - **optional**, for push-time checks or branch guards. For advisory private-repo branch protection, copy from `assets/soft-protected-branch-pre-push.sh`.

Then:

```bash
chmod +x .hk-hooks/*
git config --local core.hooksPath .hk-hooks
```

Merge into the existing `package.json` prepare script (JS projects):

```json
"prepare": "[ -n \"$CI\" ] && exit 0 || git config --local core.hooksPath .hk-hooks"
```

Wire `core.hooksPath` directly - don't use `hk install` here. `hk install`
succeeds on modern hk/Git and wires hk's own generated hooks, silently
diverging from the tracked `.hk-hooks/` wrappers this skill sets up (the
wrapper adds the `HK=0` bypass, mise discovery, and `-q`). One wiring path,
the tracked one. hk needn't be installed at prepare time - the wrapper
discovers it at commit time and errors clearly if missing.

For non-JS projects, set `core.hooksPath` manually or via a Makefile `setup` target.
Keep native package scripts as the task runner. Do not use `hk init --mise` to
seed replacement mise tasks in a JS project. Existing installation mechanisms
need a deliberate transition, not a second launcher layered on top.

### 4. Validate

```bash
hk validate                         # check schema and configuration
hk run pre-commit --plan             # inspect steps and selected files
hk check --all                       # execute the check hook, if defined
```

---

## Preferred Patterns

### Shared steps for new v2 configurations

Use top-level steps when check, fix and pre-commit share the same checks.
The URLs below illustrate 2.0.1; match both to the selected installed release.

```pkl
amends "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Builtins.pkl"

exclude = List("node_modules", "dist", ".next", ".git")
display_skip_reasons = List()
terminal_progress = false

steps {
    ["trailing-whitespace"] = Builtins.trailing_whitespace
    ["newlines"] = Builtins.newlines
    ["check-merge-conflict"] = Builtins.check_merge_conflict
}
```

This creates check, fix and pre-commit hooks. Pre-commit fixes, stages and
stashes; check and fix leave the index alone. No pre-push hook is created.
Keep branch guards, commit-message checks and other event-specific steps in
their explicit hooks. Hook overrides replace same-named shared steps entirely;
other shared steps still apply.

Explicit hook-only configurations remain valid. Retain their layout during
maintenance; declare `fix = true` and `stash = "git"` on an explicit pre-commit
hook. Use `stage = true` on another hook only when staging is intended.
See `references/complete-examples.md` for configurations with distinct hooks.

### Binary file excludes

Always exclude binary/font files from trailing-whitespace, newlines, and typos:

```pkl
local binary_excludes = List(
    "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico",
    "*.woff", "*.woff2", "*.ttf", "*.eot", "*.pdf", "*.zip"
)

["trailing-whitespace"] = (Builtins.trailing_whitespace) {
    exclude = binary_excludes
}
```

### Keeping steps quiet - one flag on the hook wrapper

Use `hk run <hook> -q` with normal output summaries. Do not pair it with
`output_summary = "hide"` or use `--silent`: both hide failure diagnostics.
For supported versions and output verification, read `references/output-noise.md`.

### Whole-graph checks

Some tools inspect the whole repo graph and should not receive `{{files}}`:
dependency-cruiser, knip, supply-chain scanners, link checkers, full typechecks,
and coverage gates. Wire them as ordinary steps with no `glob` when the check
must always see the full graph. (Which supply-chain scan to run, and its
block-vs-report severity split, is the supply-chain-hardening skill's call -
this skill owns the wiring.)

Globless is not only about what the tool accepts. **A globbed step does not run
at all when the only staged change is a deletion**: hk resolves the glob to zero
files and the step never appears in the plan, while a globless step still runs
(with "0 files"). Any invariant broken by *removing* a file - a link checker, a
dead-reference check, a manifest-vs-tree gate - must therefore be globless, or
it goes quiet in exactly the case it exists for.

For dependency-cruiser:

```pkl
local depcruise_step = new Step {
    check = "pnpm --silent check:deps"
}
```

Use a package script so the long command and config path live with the JS
project:

```json
"check:deps": "depcruise src --config .dependency-cruiser.cjs --output-type err-long --no-progress --no-cache"
```

Prefer putting whole-graph checks in a full `quality`, `check`, CI, or pre-push
hook. Promote to staged pre-commit only after measuring the step and confirming
the added latency is acceptable for normal commits.

### The .hk-hooks/pre-commit wrapper

This is the file git actually executes. It's tracked in git (unlike `.git/hooks/`).
Use `exec` so exit status and diagnostics reach Git. The wrapper adds an `HK=0`
bypass and discovers hk via mise when it is absent from `PATH`. Its output
contract is in `references/output-noise.md`.

```sh
#!/bin/sh
# hk pre-commit hook - tracked wrapper. Streams hk output directly.

# HK=0 bypasses all hooks (mirrors `HK=0 git commit`).
if [ "${HK:-1}" = "0" ]; then
  exit 0
fi

# Find hk: on PATH, else via mise (covers shells without mise activated).
HK_BIN=""
if command -v hk >/dev/null 2>&1; then
  HK_BIN="$(command -v hk)"
elif command -v mise >/dev/null 2>&1; then
  HK_BIN="$(mise which hk 2>/dev/null || true)"
fi

if [ -z "$HK_BIN" ]; then
  echo "hk not found. Install tools with: mise install" >&2
  exit 1
fi

exec "$HK_BIN" run pre-commit -q "$@"
```

For hooks that only delegate to hk, use simpler wrappers:

```sh
#!/bin/sh
exec hk run commit-msg "$@"
```

```sh
#!/bin/sh
exec hk run pre-push "$@"
```

### Soft-protected branch pre-push

Use this rarely: small/private/shared repos where server-side branch protection is
unavailable or intentionally advisory, but collaborators should be steered away
from direct pushes to `main`/`master`. Prefer server-side branch rules when they
are available. This is not a security boundary: hooks are per clone, require
`core.hooksPath`, and can be bypassed with `--no-verify`.

Copy `assets/soft-protected-branch-pre-push.sh` to `.hk-hooks/pre-push` and make
it executable:

```bash
cp /path/to/skill/assets/soft-protected-branch-pre-push.sh .hk-hooks/pre-push
chmod +x .hk-hooks/pre-push
git config --local core.hooksPath .hk-hooks
```

Pattern:

- Parse Git's pre-push stdin and block by `remote_ref`, not the current branch.
  Current-branch checks miss pushes like `git push origin feature:main`.
- Default-block direct pushes to `refs/heads/main` and `refs/heads/master`.
- Let owner clones opt out with repo-local config:
  `git config --local hooks.allowMainPush true`.
- Keep one-off automation escape hatch explicit: `HK_ALLOW_MAIN_PUSH=1 git push`.
- Document the advisory nature and opt-out in repo docs/agent instructions.

### pnpm build-script decision check

A dependency with a lifecycle script (`preinstall`/`install`/`postinstall`, or
a `binding.gyp`) needs a decision recorded in `pnpm-workspace.yaml`
`allowBuilds`. Without one, pnpm 11 fails the install closed
(`ERR_PNPM_IGNORED_BUILDS`) - but **only where nothing masks its check**. On a
machine with a global `ignoreScripts`, the install is green, a cold reinstall
is green, and the failure lands in CI or a platform build instead.

Copy `assets/pnpm-build-scripts-check.mjs` to `.hk-hooks/` and glob the step on
the files that can change the dependency tree:

```pkl
["pnpm-build-scripts"] {
    glob = List("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")
    check = "node .hk-hooks/pnpm-build-scripts-check.mjs"
}
```

Pattern:

- **Read config, run nothing.** The checker parses installed manifests and
  `pnpm-workspace.yaml`. pnpm has no detect-without-execute mode, and its own
  reporting (`pnpm ignored-builds`, `.modules.yaml`) is computed under the
  masking setting, so it reports the mask rather than the missing decision. The
  one local command that does reproduce CI -
  `pnpm install --ignore-scripts=false` - re-enables the scripts the posture
  blocks, so it is not a check.
- **Never brick what it can't evaluate**: absent `node_modules`, or no pnpm
  project, warns and exits 0 (same posture as a typecheck step on a fresh
  clone).
- `--json` for machine consumption; the human output caps the listing and
  reports the true total.
- **Whether a package gets `true` or `false` is the user's security decision** -
  the supply-chain-hardening skill owns that call. This step only insists the
  decision exists.

Known limit: it reads the *installed* tree, so it sees the optional
dependencies resolved for this platform. A postinstall that only ships in a
`linux-x64` package is invisible to any local check; only a CI job on the
target platform closes that gap.

## Pkl Syntax Reference

Use the versioned `amends` and `import` pair shown above. Builtin availability
comes from that schema package, not merely from the executable on `PATH`.

### Builtin step (use as-is)

```pkl
["trailing-whitespace"] = Builtins.trailing_whitespace
```

### Builtin step (with overrides)

```pkl
["trailing-whitespace"] = (Builtins.trailing_whitespace) {
    exclude = List("*.png", "*.jpg")
    batch = true
}
```

### Overriding builtin commands in v2

Preserve a builtin's `CommandSpec` effect when changing only its command:

```pkl
["hk-test"] = (Builtins.hk_test) {
    check {
        command = "env -u GIT_DIR -u GIT_WORK_TREE hk test --quiet"
    }
}
```

A plain string assignment replaces the object and loses its declared effect.
Check the selected builtin definition before amending it; not every command is
an object. For structured argv commands, a launcher prefix is an argv list,
such as `prefix = List("pnpm", "exec")`, not a shell string.

### Custom step

```pkl
["typecheck"] {
    glob = List("*.ts", "*.tsx")       // optional: only run when these files staged
    check = "pnpm exec tsc --noEmit"   // silent on success - no wrapper needed
    // fix = "command to auto-fix"     // optional
}
```

### Template variables

| Variable | Value |
|----------|-------|
| `{{files}}` | Selected file arguments after step filters; selection depends on the hook and flags |
| `{{commit_msg_file}}` | Path to commit message file (commit-msg hook only) |
| `{{workspace}}` | Directory containing `workspace_indicator` file |
| `{{workspace_files}}` | Files relative to workspace directory |
| `{{root}}` | Repo root. Inside a `tests {}` block it still points at the real root, not the sandbox - that is what lets `before` copy a checker in |
| `{{tmp}}` | Per-test sandbox directory. `tests {}` only; using it auto-enables `tmpdir` |

### Separate hook memberships

Use explicit hooks and local `Mapping<String, Step>` values when hooks need
different checks. See `references/complete-examples.md`; the v1 equivalent is
in `references/versions-and-migration.md`.

### Ordering steps

Use `depends = List("prettier")` to order an ordinary step after prettier.
Groups create sequential boundaries between parallel step collections; see
[hook ordering](https://hk.jdx.dev/hooks#order-steps-deliberately) for syntax.
Before relying on tests inside groups, check `hk test --list` against the
expected cases. See `references/testing-steps.md` for the group-discovery limit.

---

## mise.toml Additions

```toml
[tools]
hk = "2"

# Add as needed based on detected steps:
typos = "latest"      # Tier 2: spell check
gitleaks = "latest"   # Tier 2: secret detection
rumdl = "latest"      # Tier 2: markdown lint (if .md files present)
yamllint = "latest"   # Tier 4: YAML lint (if .yamllint* present)
```

---

## Maintenance

### Add a new step

Insert into `hk.pkl` under the appropriate section. Check `hk builtins` for available built-ins, or write a custom step.

### Update hk version

For a requested upgrade, follow `references/versions-and-migration.md` before
changing the tool pin and both schema URLs. Validate the config and inspect
hook plans with the selected binary, then run the relevant checks. A matching
version number alone does not verify staging or hook membership.

### Bypass hooks temporarily

```bash
HK=0 git commit -m "wip"             # skip all hk hooks
HK_SKIP_STEPS=vitest git commit      # skip specific step
```

### Debug a failing step

```bash
hk check -v                          # verbose output
hk check -v --step typecheck         # single step only
hk run pre-commit -v                 # simulate hook run
```

### Local developer overrides

Use a gitignored `hk.local.pkl` beginning with `amends "./hk.pkl"`.
Amend only the intended hook or step. Replacing a hook's steps mapping does not
remove inherited top-level steps; replace the top-level mapping too when
removing all shared steps. See the [local override reference](https://hk.jdx.dev/configuration#hk-local-pkl).

---

## Gotchas

| Issue | Fix |
|-------|-----|
| `pkl: command not found` | V2 embeds its evaluator. Inspect the failing command or v1 backend before adding a standalone Pkl dependency |
| `amends` version mismatch | Match amends/import URL version to `hk --version` output |
| Builtins snake_case vs step names kebab-case | `Builtins.trailing_whitespace` → `["trailing-whitespace"]` |
| Hook runs but matches nothing | Check glob patterns; use `hk check -v` to see file matching |
| Step fails when `{{files}}` holds nothing the tool handles | A glob decides what the step *runs on*, not what the tool *accepts*: several exit non-zero on an empty target set rather than no-op. `oxfmt` errors "Expected at least one target file" when every passed path sits in its own `ignorePatterns`; `oxlint` does the same given no lintable file. Glob each step to what that tool actually handles, and keep lint and format as separate steps - a combined one globbing `*.json` fails on a JSON-only commit |
| Binary files fail spell check | Add binary excludes to typos/trailing-whitespace/newlines steps |
| Git worktrees: `hk install` fails | Automatic since v1.35.0; if using older version use `.hk-hooks/` + `core.hooksPath` |
| Fix staging differs from expectations | V2 stages by default only in pre-commit. Hook `stage` enables staging; step `stage` filters paths. See `references/versions-and-migration.md` |
| Noisy output on success | Use the wrapper and summary settings in `references/output-noise.md` |
| Hook runs in CI unnecessarily | Add `[ -n "$CI" ] && exit 0` to `prepare` script |
| `hk.local.pkl` uses amends not being honoured | First line must be `amends "./hk.pkl"` |
| A builtin named in the docs does not resolve | The builtin set is tied to the version in your `amends`/`import` URL, not to the installed `hk`. Check that tag's `pkl/builtins/` before reaching for one - `statix`, for instance, is absent at 1.56.1 while `deadnix`, `lychee`, `check_symlinks`, `check_case_conflict` and `hk_test` are all present |
| `hk check --all` seems to miss files | It selects tracked and eligible untracked files. Stashing excludes untracked files; `HK_STASH_UNTRACKED=0` disables their discovery. Inspect the plan and effective settings before changing excludes |
| `vale` fails on a deliberately-malformed frontmatter fixture | Vale hard-errors (E201) on unparseable frontmatter rather than skipping the file, so test fixtures that are invalid *on purpose* have to be excluded from the step, the same way lint fixtures are |
| `pinact` fails whenever the machine is offline | It resolves every action ref through the GitHub API (`/repos/<owner>/<repo>/commits/<ref>`) and has no offline mode, so an unreachable API is a hard failure (exit 1 on 3.10.1), identical to the one it reports for a genuinely unpinned action. Put it in CI, not pre-commit - the same reason `zizmor` runs `--offline` in the hook |
| Step tests write fixtures into the work tree | A bare relative path with no `tmpdir = true` writes into the repo and leaves the file there. Use `{{tmp}}/...`. See `references/testing-steps.md` |

---

## References

- `references/versions-and-migration.md` - read for v1 maintenance, version mismatches or requested upgrades to v2
- `references/builtins-by-language.md` - step selection by ecosystem
- `references/complete-examples.md` - full hk.pkl configs for different stacks
- `references/output-noise.md` - how to keep steps quiet correctly (wrapper-level `-q`, hk's native controls, failure-summary caveat)
- `references/testing-steps.md` - `tests {}` and `hk test`: the fields, the `{{tmp}}` sandbox rule, testing a whole-repo checker with `before` + `{{root}}`, and what `Builtins.hk_test` drags in
- `assets/soft-protected-branch-pre-push.sh` - copy to `.hk-hooks/pre-push` for advisory local branch protection with clone-local owner opt-out
- `tests/soft-protected-branch-pre-push.bats` - behavioural tests for the advisory branch-protection asset
- `assets/pnpm-build-scripts-check.mjs` - copy to `.hk-hooks/` to fail a commit when a dependency's build script has no `allowBuilds` decision
- `tests/pnpm-build-scripts-check.bats` - behavioural tests for the build-script decision checker
- `evals/prompts.md` - setup, maintenance and migration prompts with acceptance criteria
- [hk docs](https://hk.jdx.dev) - official documentation
- `hk builtins` - list all available built-in linters
