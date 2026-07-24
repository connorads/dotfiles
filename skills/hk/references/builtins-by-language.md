# hk Builtins by Language/Ecosystem

## Contents

- Universal (always add)
- Common Tools (add if relevant)
  - Spell checking (typos)
  - Secret detection (gitleaks)
  - Markdown linting (rumdl)
- JavaScript / TypeScript
  - Formatter: Biome (signal: `biome.json` or `biome.jsonc`)
  - Formatter: Prettier (signal: `.prettierrc*` or no biome)
  - Linter: ESLint (signal: `eslint.config.*`)
  - Type checking
  - Test runners
  - Commit message validation (signal: `commitlint.config.*`)
  - Package manager detection
- Go
- Rust
- Python
  - Formatter + linter: Ruff (preferred, signal: `ruff.toml` or `[tool.ruff]` in `pyproject.toml`)
  - Legacy: Black + Flake8
  - Type checking
- Nix
- Shell
- YAML (signal: `.yamllint*`)
- CSS
- Dockerfile (signal: `Dockerfile*`)
- Terraform / OpenTofu (signal: `*.tf`)
- GitHub Actions (signal: `.github/workflows/*.yml`)
- Team/Shared Repo Guards

Reference for choosing steps when setting up hk in a new repo. Run `hk builtins` for the full list.

**On keeping output quiet:** steps below run their plain commands. Success noise is dropped at
the hook level by `hk run pre-commit -q` (hk ≥ 1.51.0: 0 bytes on success, full failing-step
output on failure) — no per-step wrapper. Harmless tool-native flags (`ruff check -q`,
`gitleaks --log-level=error`) are kept where they also cut redundant output. See
`references/output-noise.md`.

## Universal (always add)

```pkl
["trailing-whitespace"] = (Builtins.trailing_whitespace) {
    exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico",
                   "*.woff", "*.woff2", "*.ttf", "*.eot", "*.pdf", "*.zip")
}
["newlines"] = (Builtins.newlines) {
    exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico",
                   "*.woff", "*.woff2", "*.ttf", "*.eot", "*.pdf", "*.zip")
}
["check-merge-conflict"] = (Builtins.check_merge_conflict) {}
```

## Common Tools (add if relevant)

### Spell checking (typos)

```pkl
["typos"] = (Builtins.typos) {
    exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico",
                   "*.woff", "*.woff2", "*.ttf", "*.eot", "pnpm-lock.yaml",
                   "package-lock.json", "yarn.lock", "Cargo.lock", "go.sum")
}
```

Configure locale in `_typos.toml`:

```toml
[default]
locale = "en-gb"   # or "en-us"
```

**Locale mode rewrites US-spelled identifiers in code.** With `en-gb`, typos
"corrects" US spellings even inside string literals — CLI flags, protocol/schema
names, CSS keywords, API fields — which can silently break the build or the wire.
Allow-list each as an identity map so the word maps to itself (i.e. is left
alone). Keep a `why` comment per entry; describe the class you keep hitting, not
a one-off:

```toml
[default.extend-words]
# US-spelled EXTERNAL identifiers that must not be en-gb "corrected".
flavor = "flavor"               # pyftsubset --flavor / --flavour is "Unknown option"
color = "color"                 # CSS + countless API fields; -> "colour" breaks them
center = "center"               # CSS keyword (text-align, etc.)
behavior = "behavior"           # scrollIntoView({ behavior }), API fields
Organization = "Organization"   # schema.org @type; -> "Organisation" is invalid JSON-LD
authorization = "authorization" # HTTP header; -> "authorisation" fails auth
```

Trade-off: `extend-words` is **repo-global** — an entry also suppresses a genuine
en-gb correction of that word in prose (e.g. `color` in body text stays
US-spelled). That is usually the right call for identifier-heavy repos; if a word
is a real problem only in code, prefer scoping via `[type.<ext>]` /
`extend-glob` overrides so prose still gets corrected.

### Secret detection (gitleaks)

```pkl
["gitleaks"] {
    check = "gitleaks detect --no-banner --redact --log-level=error"  // silent on success (--log-level=error)
}
```

Requires `gitleaks = "latest"` in `mise.toml`.

### Markdown linting (rumdl)

```pkl
["rumdl"] = (Builtins.rumdl) {}
```

Requires `rumdl = "latest"` in `mise.toml`. Configure in `.rumdl.toml`:

```toml
[default]
extend_rule_off = ["MD013", "MD033"]  # disable line-length and inline HTML rules
```

---

## JavaScript / TypeScript

### Formatter: Biome (signal: `biome.json` or `biome.jsonc`)

biome/ultracite print a `Checked N files…` summary on success — dropped by wrapper-level `-q`:

```pkl
["biome"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.css")
    check = "pnpm exec biome check {{files}}"
    fix = "pnpm exec biome check --write {{files}}"
}
```

Or via [ultracite](https://github.com/haydenbleasel/ultracite) wrapper:

```pkl
["biome"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.css")
    check = "pnpm exec ultracite check --error-on-warnings=true {{files}}"
    fix = "pnpm exec ultracite fix {{files}}"
}
```

### Formatter: Prettier (signal: `.prettierrc*` or no biome)

prettier `--check` prints `All matched files use Prettier code style!` on success — dropped by
wrapper-level `-q`:

```pkl
["prettier"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.mjs", "*.json", "*.css", "*.md", "*.mdx")
    check = "pnpm exec prettier --check {{files}}"
    fix = "pnpm exec prettier --write {{files}}"
}
```

Add framework-specific globs as needed: `"*.astro"`, `"*.svelte"`, `"*.vue"`.

### Linter: ESLint (signal: `eslint.config.*`)

eslint is silent on success anyway:

```pkl
["eslint"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.mjs")
    check = "pnpm exec eslint {{files}}"
    fix = "pnpm exec eslint --fix {{files}}"
}
```

Add `"*.astro"`, `"*.svelte"`, `"*.vue"` to glob if using those frameworks.

### Type checking

`tsc`/`tsgo --noEmit` are silent on success. `astro check` / `svelte-check` print a result
summary on success, dropped by wrapper-level `-q`.

**Plain TypeScript (`tsconfig.json`):**

```pkl
["typecheck"] {
    check = "pnpm exec tsc --noEmit"   // silent on success
}
```

**Native TS compiler preview (tsgo — faster):**

```pkl
["typecheck"] {
    check = "pnpm exec tsgo --noEmit"   // silent on success
}
```

**Astro:**

```pkl
["typecheck"] {
    check = "pnpm exec astro check"
}
```

**SvelteKit:**

```pkl
["typecheck"] {
    check = "pnpm exec svelte-kit sync && pnpm exec svelte-check"
}
```

**Next.js / Vite:** standard tsc usually sufficient.

### Test runners

Test runners print a reporter summary on success and have no true silence flag
(their own `--silent` only mutes test `console.log`, not the reporter) — wrapper-level `-q`
drops it on success and keeps it on failure.

**Vitest:**

```pkl
["vitest"] {
    check = "pnpm exec vitest run"
}
```

**Jest:**

```pkl
["jest"] {
    check = "pnpm exec jest --passWithNoTests"
}
```

**Note:** E2E tests (Playwright, Cypress) should NOT be in pre-commit — they're too slow. Run them in CI only.

### Commit message validation (signal: `commitlint.config.*`)

Add a `commit-msg` hook:

```pkl
["commit-msg"] {
    steps {
        ["commitlint"] {
            check = "pnpm exec commitlint --edit {{commit_msg_file}}"
        }
    }
}
```

### Package manager detection

| Signal file | Package manager | Command prefix |
|------------|-----------------|----------------|
| `pnpm-lock.yaml` | pnpm | `pnpm exec` |
| `bun.lock` / `bun.lockb` | bun | `bun x` / `bunx` |
| `yarn.lock` | yarn | `yarn` |
| `package-lock.json` | npm | `npx` |

---

## Go

```pkl
["go-fmt"] = (Builtins.go_fmt) {}
["go-vet"] = (Builtins.go_vet) {}
["golangci-lint"] = (Builtins.golangci_lint) {}
["gomod-tidy"] = (Builtins.gomod_tidy) {}
```

Tests:

```pkl
["go-test"] {
    check = "go test ./..."
}
```

---

## Rust

```pkl
["cargo-fmt"] = (Builtins.cargo_fmt) {}
["cargo-clippy"] = (Builtins.cargo_clippy) {}
```

Tests:

```pkl
["cargo-test"] {
    check = "cargo test"
}
```

---

## Python

### Formatter + linter: Ruff (preferred, signal: `ruff.toml` or `[tool.ruff]` in `pyproject.toml`)

```pkl
["ruff-format"] = (Builtins.ruff_format) {}   // builtin already passes --quiet (silent on success)
["ruff"] = (Builtins.ruff) {
    // Builtins.ruff runs `ruff check`, which prints `All checks passed!`.
    // Keep its native -q (0 bytes on success); wrapper-level -q covers it too.
    check = "ruff check -q --force-exclude {{files}}"
}
```

### Legacy: Black + Flake8

```pkl
["black"] = (Builtins.black) {}
["flake8"] = (Builtins.flake8) {}
```

### Type checking

```pkl
["mypy"] = (Builtins.mypy) {}   // check-only builtin (no fix command)
```

Tests:

```pkl
["pytest"] {
    check = "pytest"   // prints dots + summary on success (even its own `-q`); wrapper-level -q drops it
}
```

---

## Nix

```pkl
["nixfmt"] = (Builtins.nix_fmt) { batch = true }
["deadnix"] = (Builtins.deadnix) {}
```

---

## Shell

```pkl
["shfmt"] = (Builtins.shfmt) { batch = true }
["shellcheck"] = (Builtins.shellcheck) { batch = true }
```

Custom glob for specific shell file patterns:

```pkl
["zsh-syntax"] {
    glob = List(".zshrc", ".zprofile", ".config/zsh/functions/**")
    check = "zsh -n {{files}}"
}
```

---

## YAML (signal: `.yamllint*`)

```pkl
["yamllint"] = (Builtins.yamllint) {}
```

Requires `yamllint = "latest"` in `mise.toml`. Configure in `.yamllint.yaml`:

```yaml
extends: default
rules:
  line-length:
    max: 200
  document-start: disable
```

---

## CSS

With Prettier (usually sufficient), or:

```pkl
["stylelint"] = (Builtins.stylelint) {}
```

---

## Dockerfile (signal: `Dockerfile*`)

```pkl
["hadolint"] = (Builtins.hadolint) {}
```

---

## Terraform / OpenTofu (signal: `*.tf`)

```pkl
["hclfmt"] = (Builtins.hclfmt) {}
["tflint"] = (Builtins.tf_lint) {}
```

---

## GitHub Actions (signal: `.github/workflows/*.yml`)

```pkl
["actionlint"] = (Builtins.actionlint) {}
```

---

## Team/Shared Repo Guards

Block direct commits to protected branches:

```pkl
// In pre-commit steps:
["no-commit-to-branch"] {
    check = """
      branch=$(git rev-parse --abbrev-ref HEAD)
      if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
        echo "Direct commits to '$branch' are not allowed."
        echo "Create a feature branch: git checkout -b feature/my-change"
        exit 1
      fi
      """
}
```

For push guards, prefer server-side branch protection. If local advisory
protection is the right trade-off, copy
`assets/soft-protected-branch-pre-push.sh` to `.hk-hooks/pre-push`. It parses
Git's pre-push stdin and checks the `remote_ref`; current-branch checks miss
pushes like `git push origin feature:main`.
