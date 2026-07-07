---
name: hk
description: Set up and maintain hk git hook manager in any repository. Use when adding pre-commit hooks, configuring linters, setting up code quality automation, working with hk.pkl, or maintaining existing hook configurations. Triggers on tasks involving hk, git hooks, pre-commit checks, commit-msg validation, or linting pipelines.
---

# hk — Git Hook Manager

[hk](https://hk.jdx.dev) by jdx runs linters and formatters as git hooks with **built-in parallelism**, **file locking** (no race conditions), and **staged-file-only** operation (no separate lint-staged needed). Config is in Pkl — Apple's typed configuration language.

## Mental Model

Every hk setup is three steps: **detect** what the project has → **compose** steps from tiers → **wire** the hooks in.

```text
detect project type + tools
         ↓
compose hk.pkl (tiered steps)
         ↓
wire: mise.toml + .hk-hooks/ + prepare script
```

## Setup Workflow

### 1. Detect

```bash
hk --version                    # get current version for amends URL
ls package.json go.mod Cargo.toml pyproject.toml flake.nix Makefile
cat mise.toml package.json      # existing tools, package manager, scripts
```

Identify:

- Language(s) and framework
- Package manager (pnpm/bun/npm/yarn for JS, cargo, go, pip, etc.)
- Formatter already configured (prettier, biome, ruff, gofmt…)
- Linter already configured (eslint, golangci-lint, ruff, clippy…)
- Test runner (vitest, jest, go test, cargo test, pytest…)
- Whether it's a team/shared repo, and whether branch protection should be hard
  server-side protection or advisory local hook protection

### 2. Choose steps (tiered)

**Tier 1 — Universal (always add):**

| Step | Builtin |
|------|---------|
| trailing-whitespace | `Builtins.trailing_whitespace` |
| newlines | `Builtins.newlines` |
| check-merge-conflict | `Builtins.check_merge_conflict` |

**Tier 2 — Common tools (add if relevant):**

| Step | Builtin | When |
|------|---------|------|
| typos | `Builtins.typos` | Always (fast spell check) |
| gitleaks | custom | Always (secret detection) |
| rumdl | `Builtins.rumdl` | If `*.md` files exist |

**Tier 3 — Language-specific** (see `references/builtins-by-language.md`):

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

**Tier 4 — Project-specific (detect from config files):**

| Signal | Step |
|--------|------|
| `commitlint.config.*` exists | commit-msg hook with commitlint |
| `.dependency-cruiser.*` or `check:deps` exists | whole-graph architecture check |
| `.yamllint*` exists | yamllint |
| Team/shared repo | no-commit-to-branch (pre-commit), branch guard (pre-push). For advisory private-repo protection with owner opt-out, use the soft-protected pre-push asset below. |
| Test runner detected | test step(s) — vitest/jest/go test/cargo test/pytest |

### 3. Wire the hooks

Three files to create/update, plus optional extras:

1. `mise.toml` — add hk, pkl, tool binaries
2. `hk.pkl` — configuration
3. `.hk-hooks/pre-commit` — tracked hook wrapper
4. `scripts/quiet-on-success.sh` — **optional**, only if you have chatty-on-success steps (test runners, tools with no silent mode). Most check-style linters are already silent on success — don't wrap them. See `references/output-noise.md`. Copy from `assets/quiet-on-success.sh` in this skill.
5. `.hk-hooks/pre-push` — **optional**, for push-time checks or branch guards. For advisory private-repo branch protection, copy from `assets/soft-protected-branch-pre-push.sh`.

Then:

```bash
chmod +x .hk-hooks/*
[ -f scripts/quiet-on-success.sh ] && chmod +x scripts/quiet-on-success.sh
git config --local core.hooksPath .hk-hooks
```

And add to `package.json` prepare script (JS projects):

```json
"prepare": "[ -n \"$CI\" ] && exit 0 || command -v hk >/dev/null && (hk install 2>/dev/null || git config --local core.hooksPath .hk-hooks) || echo 'Note: hk not found, skipping git hooks. Install mise to enable.'"
```

For non-JS projects, set `core.hooksPath` manually or via a Makefile `setup` target.

### 4. Validate

```bash
hk check --all      # verify all steps pass on existing files
hk validate         # verify hk.pkl is valid Pkl
```

---

## Preferred Patterns

### hk.pkl global settings

Always use these at the top (after the amends/import lines):

```pkl
exclude = List("node_modules", "dist", ".next", ".git")  // add project-specific dirs
display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // disable OSC terminal-progress escape sequences (NOT stdout noise — see references/output-noise.md)
```

Always use these on the pre-commit hook:

```pkl
["pre-commit"] {
    fix = true        // auto-fix and re-stage
    stash = "git"     // isolate staged changes
    steps { ... }
}
```

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

### Keeping steps quiet — suppress at the source

hk has **no native quiet-on-success** in a non-TTY/agentic context — `-q`, `--silent`,
`HK_LOG`, etc. are no-ops on the log dump. So if a step is noisy on success, you must quiet
the *command it runs*, not hk. Three tiers, decided per tool (see `references/output-noise.md`):

1. **Truly silent on success** (eslint, `tsc --noEmit`, shellcheck, gitleaks `--log-level=error`)
   → do nothing. **Don't wrap these** — the wrapper buys nothing.
2. **Prints a summary but has a true silence flag** (`ruff check` → `ruff check -q`, verified 0 bytes)
   → use the flag. More direct than the wrapper, keeps colour/streaming.
3. **Prints on success, no silence flag** (test runners — pytest, vitest, jest, go/cargo test)
   → wrap with `scripts/quiet-on-success.sh` (the universal fallback):

```pkl
["vitest"] {
    check = "scripts/quiet-on-success.sh pnpm exec vitest run"  // prints on success; wrapper suppresses it
}
```

Copy `assets/quiet-on-success.sh` from this skill directory into `scripts/` in the target
repo (only needed if you have any tier-3 steps). Measured: vitest 734→233 bytes (−68%),
failure output unchanged.

### Whole-graph checks

Some tools inspect the whole repo graph and should not receive `{{files}}`:
dependency-cruiser, knip, supply-chain scanners, full typechecks, and coverage
gates. Wire them as ordinary steps with no `glob` when the check must always see
the full graph.

For dependency-cruiser:

```pkl
local depcruise_step = new Step {
    check = "scripts/quiet-on-success.sh pnpm --silent check:deps"
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
Don't capture hk's output — let it stream so colour, progress, and slow-run feedback
survive (and so a successful run visibly *ran*). The wrapper just adds an `HK=0` bypass
and discovers hk via mise when it isn't on `PATH`:

```sh
#!/bin/sh
# hk pre-commit hook — tracked wrapper. Streams hk output directly.

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

exec "$HK_BIN" run pre-commit "$@"
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

## Pkl Syntax Reference

### Required first lines

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Builtins.pkl"
```

**Always match the version in `amends` and `import` to the installed hk version** (`hk --version`).

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

### Native per-step output controls

hk exposes two per-step knobs that trim *its* chrome — neither suppresses a command's own
output (only a silent command or the wrapper does that):

```pkl
["typecheck"] {
    check = "pnpm exec tsc --noEmit"
    output_summary = "stderr"   // end-of-run summary stream: "stderr" (default) | "stdout" | "combined" | "hide"
    hide = false                // true removes this step's status markers (the ✔/✖ lines)
}
```

On failure hk prints the output **twice** (live stream + end summary). `output_summary = "hide"`
drops the duplicate summary, but it's **only safe under head-keeping output truncation** (the
live error survives) and **unsafe under tail-keeping harnesses** (the summary is the only
survivor). Default: leave hk's default. See `references/output-noise.md` for the caveat.

### Custom step

```pkl
["typecheck"] {
    glob = List("*.ts", "*.tsx")       // optional: only run when these files staged
    check = "pnpm exec tsc --noEmit"   // silent on success — no wrapper needed
    // fix = "command to auto-fix"     // optional
}
```

### Template variables

| Variable | Value |
|----------|-------|
| `{{files}}` | Space-separated list of staged files matching the step's glob |
| `{{commit_msg_file}}` | Path to commit message file (commit-msg hook only) |
| `{{workspace}}` | Directory containing `workspace_indicator` file |
| `{{workspace_files}}` | Files relative to workspace directory |

### Multi-line inline script

```pkl
["no-commit-to-branch"] {
    check = """
      branch=$(git rev-parse --abbrev-ref HEAD)
      if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
        echo "Direct commits to '$branch' are not allowed."
        exit 1
      fi
      """
}
```

### Local variable (share steps across hooks)

```pkl
local fast_steps = new Mapping<String, Step> {
    ["trailing-whitespace"] = Builtins.trailing_whitespace
    ["shfmt"] = (Builtins.shfmt) { batch = true }
}

hooks {
    ["pre-commit"] { fix = true; stash = "git"; steps = fast_steps }
    ["check"] { steps = fast_steps }
    ["fix"] { fix = true; stash = "git"; steps = fast_steps }
}
```

### Sequential ordering with Groups

Steps within a group run in parallel; groups run sequentially:

```pkl
steps {
    ["format"] = new Group {
        steps = new Mapping<String, Step> {
            ["prettier"] { ... }
            ["eslint"] { ... }
        }
    }
    ["validate"] = new Group {   // runs after format completes
        steps = new Mapping<String, Step> {
            ["typecheck"] { ... }
            ["test"] { ... }
        }
    }
}
```

Or use `depends` for fine-grained ordering:

```pkl
["eslint"] {
    depends = List("prettier")   // waits for prettier to finish
    ...
}
```

---

## mise.toml Additions

```toml
[tools]
hk = "latest"
pkl = "latest"        # required for hk.pkl parsing

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

```bash
hk --version   # check current
```

Bump both URLs in `hk.pkl` to the installed version, e.g.:

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Builtins.pkl"
```

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

Create `hk.local.pkl` (gitignored) to override settings locally:

```pkl
amends "./hk.pkl"
hooks {
    ["pre-commit"] {
        steps {
            ["vitest"] {
                check = "scripts/quiet-on-success.sh pnpm exec vitest run --testPathPattern=fast"
            }
        }
    }
}
```

---

## Gotchas

| Issue | Fix |
|-------|-----|
| `pkl: command not found` | Add `pkl = "latest"` to `mise.toml`, run `mise install` |
| `amends` version mismatch | Match amends/import URL version to `hk --version` output |
| Builtins snake_case vs step names kebab-case | `Builtins.trailing_whitespace` → `["trailing-whitespace"]` |
| Hook runs but matches nothing | Check glob patterns; use `hk check -v` to see file matching |
| Binary files fail spell check | Add binary excludes to typos/trailing-whitespace/newlines steps |
| Git worktrees: `hk install` fails | Automatic since v1.35.0; if using older version use `.hk-hooks/` + `core.hooksPath` |
| Fix auto-stages wrong files | Use explicit `stage` glob on the step, or ensure step `glob` covers fixed files |
| Noisy output on success | Quiet the *command*, not hk (hk has no non-TTY quiet mode). Silent flag (`ruff check -q`) or `scripts/quiet-on-success.sh` for chatty runners; native `output_summary`/`hide` only trim chrome — see `references/output-noise.md` |
| Hook runs in CI unnecessarily | Add `[ -n "$CI" ] && exit 0` to `prepare` script |
| `hk.local.pkl` uses amends not being honoured | First line must be `amends "./hk.pkl"` |

---

## References

- `references/builtins-by-language.md` — step selection by ecosystem (which steps to wrap)
- `references/complete-examples.md` — full hk.pkl configs for different stacks
- `references/output-noise.md` — how to keep steps quiet correctly (the 3-tier model, hk's native controls, harness-truncation caveat)
- `assets/quiet-on-success.sh` — copy into `scripts/` in target repo (only for tier-3 chatty steps)
- `assets/soft-protected-branch-pre-push.sh` — copy to `.hk-hooks/pre-push` for advisory local branch protection with clone-local owner opt-out
- `tests/quiet-on-success.bats` — behavioural tests for the asset (`bats tests/`)
- `tests/soft-protected-branch-pre-push.bats` — behavioural tests for the advisory branch-protection asset
- [hk docs](https://hk.jdx.dev) — official documentation
- `hk builtins` — list all 90+ available built-in linters
