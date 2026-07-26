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
3. `.hk-hooks/pre-commit` — tracked hook wrapper (runs `hk run pre-commit -q`; `-q` quiets every step on success — see `references/output-noise.md`)
4. `.hk-hooks/pre-push` — **optional**, for push-time checks or branch guards. For advisory private-repo branch protection, copy from `assets/soft-protected-branch-pre-push.sh`.

Then:

```bash
chmod +x .hk-hooks/*
git config --local core.hooksPath .hk-hooks
```

And add to `package.json` prepare script (JS projects):

```json
"prepare": "[ -n \"$CI\" ] && exit 0 || git config --local core.hooksPath .hk-hooks"
```

Wire `core.hooksPath` directly — don't use `hk install` here. `hk install`
succeeds on modern hk/Git and wires hk's own generated hooks, silently
diverging from the tracked `.hk-hooks/` wrappers this skill sets up (the
wrapper adds the `HK=0` bypass, mise discovery, and `-q`). One wiring path,
the tracked one. hk needn't be installed at prepare time — the wrapper
discovers it at commit time and errors clearly if missing.

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

### Keeping steps quiet — one flag on the hook wrapper

On hk ≥ 1.51.0 the quiet lever is **`hk run <hook> -q`** on the `.hk-hooks/pre-commit`
wrapper. `-q` natively quiets *every* step on success: **success → 0 bytes**,
**failure → the failing step's full stdout+stderr survives** (only hk's progress chrome is
dropped). No per-step wrapping, no per-tool tiering — steps run their plain commands.

```pkl
["vitest"] {
    check = "pnpm exec vitest run"   // chatty on success — silenced by wrapper-level -q
}
```

**Never use `--silent`**: it reaches 0 bytes on success too, but on failure it drops the
diagnostics (you get only `See .../output.log`). `-q` is the only safe choice. `-n`,
`HK_LOG`, `RUST_LOG` are no-ops on step success output. See `references/output-noise.md` for
the mechanism, the TTY-vs-no-TTY nuance, and measured numbers.

### Whole-graph checks

Some tools inspect the whole repo graph and should not receive `{{files}}`:
dependency-cruiser, knip, supply-chain scanners, full typechecks, and coverage
gates. Wire them as ordinary steps with no `glob` when the check must always see
the full graph. (Which supply-chain scan to run, and its block-vs-report
severity split, is the supply-chain-hardening skill's call — this skill owns
the wiring.)

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
Don't capture hk's output — `exec` it so colour, progress, and failure diagnostics stream
through. The `-q` flag drops only *success* chrome (0 bytes on a clean run); a failing step
still streams its full stdout+stderr. The wrapper also adds an `HK=0` bypass and discovers hk
via mise when it isn't on `PATH`:

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

## Pkl Syntax Reference

### Required first lines

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.51.0/hk@1.51.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.51.0/hk@1.51.0#/Builtins.pkl"
```

**Always match the version in `amends` and `import` to the installed hk version** (`hk --version`),
and require **hk ≥ 1.51.0** — the wrapper-level `-q` success quieting (see above) needs it. The
skill installs `hk = "latest"`, so fresh setups qualify; for an older pinned repo, upgrade hk.

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

### Output controls

**Run-level (preferred):** flags on `hk run <hook>`.

| Flag | Effect |
|------|--------|
| `-q` | **Quiet-on-success** (hk ≥ 1.51.0): success → 0 bytes; failure keeps the failing step's full stdout+stderr. Put this on the wrapper. |
| `--silent` | 0 bytes on success **and on failure** — drops diagnostics. **Never use it.** |
| `-n` / `--no-progress` | No-op on step success output (touches progress rendering only). |

**Per-step:** two knobs that trim *hk's* chrome — neither suppresses a command's own output
(only wrapper-level `-q` does that):

```pkl
["typecheck"] {
    check = "pnpm exec tsc --noEmit"
    output_summary = "stderr"   // end-of-run summary stream: "stderr" (default) | "stdout" | "combined" | "hide"
    hide = false                // true removes this step's status markers (the ✔/✖ lines)
}
```

Without `-q`, on failure hk prints the output **twice** (live stream + end summary), and
`output_summary = "hide"` drops the duplicate summary but is **only safe under head-keeping
output truncation**. Wrapper-level `-q` sidesteps this: it yields a single small failure copy,
safe under both head- and tail-keeping truncation. See `references/output-noise.md`.

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

Bump both URLs in `hk.pkl` to the installed version (minimum **v1.51.0**), e.g.:

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.51.0/hk@1.51.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.51.0/hk@1.51.0#/Builtins.pkl"
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
                check = "pnpm exec vitest run --testPathPattern=fast"
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
| Step fails when `{{files}}` holds nothing the tool handles | A glob decides what the step *runs on*, not what the tool *accepts*: several exit non-zero on an empty target set rather than no-op. `oxfmt` errors "Expected at least one target file" when every passed path sits in its own `ignorePatterns`; `oxlint` does the same given no lintable file. Glob each step to what that tool actually handles, and keep lint and format as separate steps — a combined one globbing `*.json` fails on a JSON-only commit |
| Binary files fail spell check | Add binary excludes to typos/trailing-whitespace/newlines steps |
| Git worktrees: `hk install` fails | Automatic since v1.35.0; if using older version use `.hk-hooks/` + `core.hooksPath` |
| Fix auto-stages wrong files | Use explicit `stage` glob on the step, or ensure step `glob` covers fixed files |
| Noisy output on success | Add `-q` to the pre-commit wrapper (`hk run pre-commit -q`, hk ≥ 1.51.0): 0 bytes on success, full failing-step output on failure. **Never `--silent`** (drops failure diagnostics). See `references/output-noise.md` |
| Hook runs in CI unnecessarily | Add `[ -n "$CI" ] && exit 0` to `prepare` script |
| `hk.local.pkl` uses amends not being honoured | First line must be `amends "./hk.pkl"` |

---

## References

- `references/builtins-by-language.md` — step selection by ecosystem
- `references/complete-examples.md` — full hk.pkl configs for different stacks
- `references/output-noise.md` — how to keep steps quiet correctly (wrapper-level `-q`, hk's native controls, harness-truncation caveat)
- `assets/soft-protected-branch-pre-push.sh` — copy to `.hk-hooks/pre-push` for advisory local branch protection with clone-local owner opt-out
- `tests/soft-protected-branch-pre-push.bats` — behavioural tests for the advisory branch-protection asset
- [hk docs](https://hk.jdx.dev) — official documentation
- `hk builtins` — list all available built-in linters
