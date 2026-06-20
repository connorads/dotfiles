# hk Builtins by Language/Ecosystem

Reference for choosing steps when setting up hk in a new repo. Run `hk builtins` for the full list.

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

### Secret detection (gitleaks)

```pkl
["gitleaks"] {
    check = "scripts/quiet-on-success.sh gitleaks detect --no-banner --redact --log-level=error"
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

```pkl
["biome"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.css")
    check = "scripts/quiet-on-success.sh pnpm exec biome check {{files}}"
    fix = "scripts/quiet-on-success.sh pnpm exec biome check --write {{files}}"
}
```

Or via [ultracite](https://github.com/haydenbleasel/ultracite) wrapper:
```pkl
["biome"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.css")
    check = "scripts/quiet-on-success.sh pnpm exec ultracite check --error-on-warnings=true {{files}}"
    fix = "scripts/quiet-on-success.sh pnpm exec ultracite fix {{files}}"
}
```

### Formatter: Prettier (signal: `.prettierrc*` or no biome)

```pkl
["prettier"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.mjs", "*.json", "*.css", "*.md", "*.mdx")
    check = "scripts/quiet-on-success.sh pnpm exec prettier --check {{files}}"
    fix = "scripts/quiet-on-success.sh pnpm exec prettier --write {{files}}"
}
```

Add framework-specific globs as needed: `"*.astro"`, `"*.svelte"`, `"*.vue"`.

### Linter: ESLint (signal: `eslint.config.*`)

```pkl
["eslint"] {
    glob = List("*.ts", "*.tsx", "*.js", "*.mjs")
    check = "scripts/quiet-on-success.sh pnpm exec eslint {{files}}"
    fix = "scripts/quiet-on-success.sh pnpm exec eslint --fix {{files}}"
}
```

Add `"*.astro"`, `"*.svelte"`, `"*.vue"` to glob if using those frameworks.

### Type checking

**Plain TypeScript (`tsconfig.json`):**
```pkl
["typecheck"] {
    check = "scripts/quiet-on-success.sh pnpm exec tsc --noEmit"
}
```

**Native TS compiler preview (tsgo — faster):**
```pkl
["typecheck"] {
    check = "scripts/quiet-on-success.sh pnpm exec tsgo --noEmit"
}
```

**Astro:**
```pkl
["typecheck"] {
    check = "scripts/quiet-on-success.sh pnpm exec astro check"
}
```

**SvelteKit:**
```pkl
["typecheck"] {
    check = "scripts/quiet-on-success.sh pnpm exec svelte-kit sync && pnpm exec svelte-check"
}
```

**Next.js / Vite:** standard tsc usually sufficient.

### Test runners

**Vitest:**
```pkl
["vitest"] {
    check = "scripts/quiet-on-success.sh pnpm exec vitest run"
}
```

**Jest:**
```pkl
["jest"] {
    check = "scripts/quiet-on-success.sh pnpm exec jest --passWithNoTests"
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
    check = "scripts/quiet-on-success.sh go test ./..."
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
    check = "scripts/quiet-on-success.sh cargo test"
}
```

---

## Python

### Formatter + linter: Ruff (preferred, signal: `ruff.toml` or `[tool.ruff]` in `pyproject.toml`)

```pkl
["ruff-format"] = (Builtins.ruff_format) {}
["ruff"] = (Builtins.ruff) {}
```

### Legacy: Black + Flake8

```pkl
["black"] = (Builtins.black) {}
["flake8"] = (Builtins.flake8) {}
```

### Type checking

```pkl
["mypy"] = (Builtins.mypy) { stomp = true }
```

Tests:
```pkl
["pytest"] {
    check = "scripts/quiet-on-success.sh pytest"
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

Block direct commits/pushes to protected branches:

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

```pkl
// In pre-push hook:
["pre-push"] {
    steps {
        ["no-push-to-branch"] {
            check = """
              branch=$(git rev-parse --abbrev-ref HEAD)
              if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
                echo "Direct pushes to '$branch' are not allowed."
                exit 1
              fi
              """
        }
    }
}
```
