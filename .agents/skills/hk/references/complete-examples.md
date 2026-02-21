# Complete hk.pkl Examples

Real configurations for different tech stacks. Bump the version in the `amends`/`import` URLs to match `hk --version`.

---

## Astro + Preact + Tailwind + pnpm

9 pre-commit steps. Simple setup — no commit-msg or pre-push hooks needed.

```pkl
// hk configuration - https://hk.jdx.dev/
amends "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Builtins.pkl"

exclude = List("node_modules", "dist", ".wrangler")

display_skip_reasons = List()
terminal_progress = false

hooks {
    ["pre-commit"] {
        fix = true
        stash = "git"
        steps {
            // Formatting (auto-fixed and staged)
            ["trailing-whitespace"] = (Builtins.trailing_whitespace) {
                exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico", "*.woff", "*.woff2", "*.ttf", "*.eot")
            }
            ["newlines"] = (Builtins.newlines) {
                exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico", "*.woff", "*.woff2", "*.ttf", "*.eot")
            }
            ["typos"] = (Builtins.typos) {
                exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico", "*.woff", "*.woff2", "*.ttf", "*.eot", "pnpm-lock.yaml")
            }
            ["prettier"] {
                glob = List("*.ts", "*.tsx", "*.js", "*.mjs", "*.json", "*.css", "*.astro", "*.md", "*.mdx")
                check = "scripts/quiet-on-success.sh pnpm exec prettier --check {{files}}"
                fix = "scripts/quiet-on-success.sh pnpm exec prettier --write {{files}}"
            }
            ["eslint"] {
                glob = List("*.ts", "*.tsx", "*.js", "*.mjs", "*.astro")
                check = "scripts/quiet-on-success.sh pnpm exec eslint {{files}}"
                fix = "scripts/quiet-on-success.sh pnpm exec eslint --fix {{files}}"
            }

            // Validation
            ["check-merge-conflict"] = (Builtins.check_merge_conflict) {}
            ["gitleaks"] {
                check = "scripts/quiet-on-success.sh gitleaks detect --no-banner --redact --log-level=error"
            }
            ["typecheck"] {
                check = "scripts/quiet-on-success.sh pnpm exec astro check"
            }
            ["vitest"] {
                check = "scripts/quiet-on-success.sh pnpm exec vitest run"
            }
        }
    }
}
```

**mise.toml additions:**
```toml
[tools]
hk = "latest"
pkl = "latest"
typos = "latest"
gitleaks = "latest"
```

---

## Payload CMS + Next.js 15 + Biome + pnpm

16 pre-commit steps + commit-msg + pre-push hooks. Comprehensive setup for a team repo.

```pkl
// hk configuration - https://hk.jdx.dev/
amends "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Builtins.pkl"

exclude = List("node_modules", "dist", ".next", ".open-next", "storybook-static")

display_skip_reasons = List()
terminal_progress = false

hooks {
    ["pre-commit"] {
        fix = true
        stash = "git"
        steps {
            // Formatting (auto-fixed and staged)
            ["trailing-whitespace"] = (Builtins.trailing_whitespace) {
                exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico", "*.woff", "*.woff2", "*.ttf", "*.eot")
            }
            ["newlines"] = (Builtins.newlines) {
                exclude = List("src/payload-types.ts", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico", "*.woff", "*.woff2", "*.ttf", "*.eot")
            }
            ["rumdl"] = (Builtins.rumdl) {}
            ["typos"] = (Builtins.typos) {
                exclude = List("*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.ico", "*.woff", "*.woff2", "*.ttf", "*.eot", "pnpm-lock.yaml")
            }
            ["biome"] {
                glob = List("*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.css")
                exclude = List(".vscode/*")
                check = "scripts/quiet-on-success.sh pnpm exec ultracite check --error-on-warnings=true {{files}}"
                fix = "scripts/quiet-on-success.sh pnpm exec ultracite fix {{files}}"
            }
            ["eslint"] {
                glob = List("*.ts", "*.tsx", "*.js", "*.jsx")
                check = "scripts/quiet-on-success.sh pnpm exec eslint {{files}}"
                fix = "scripts/quiet-on-success.sh pnpm exec eslint --fix {{files}}"
            }

            // Validation
            ["yamllint"] = (Builtins.yamllint) {}
            ["check-merge-conflict"] = (Builtins.check_merge_conflict) {}
            ["no-commit-to-branch"] {
                check = """
                  branch=$(git rev-parse --abbrev-ref HEAD)
                  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
                    echo "Direct commits to '$branch' are not allowed."
                    echo ""
                    echo "Please create a feature branch and open a pull request:"
                    echo "  git checkout -b feature/my-change"
                    echo "  git commit"
                    echo "  git push -u origin feature/my-change"
                    echo "  gh pr create"
                    exit 1
                  fi
                  """
            }
            ["gitleaks"] {
                check = "scripts/quiet-on-success.sh gitleaks detect --no-banner --redact --log-level=error"
            }
            ["check-migrations"] {
                glob = List("src/collections/*", "src/blocks/*", "src/globals/*", "payload.config.ts")
                check = "scripts/quiet-on-success.sh pnpm check:migrations"
            }
            ["typecheck"] {
                check = "scripts/quiet-on-success.sh pnpm typecheck:fast"
            }

            // Tests
            ["test-unit"] {
                check = "scripts/quiet-on-success.sh pnpm test:unit:coverage"
            }
            ["test-int"] {
                check = "scripts/quiet-on-success.sh pnpm test:int:coverage"
            }
            ["test-components"] {
                check = "scripts/quiet-on-success.sh pnpm test:components"
            }
            ["lint-stories"] {
                check = "scripts/quiet-on-success.sh pnpm lint:stories"
            }
            ["test-storybook"] {
                check = "scripts/quiet-on-success.sh pnpm test:storybook:ci"
            }
        }
    }
    ["commit-msg"] {
        steps {
            ["commitlint"] {
                check = "pnpm exec commitlint --edit {{commit_msg_file}}"
            }
        }
    }
    ["pre-push"] {
        steps {
            ["no-push-to-branch"] {
                check = """
                  branch=$(git rev-parse --abbrev-ref HEAD)
                  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
                    echo "Direct pushes to '$branch' are not allowed."
                    echo ""
                    echo "Please create a feature branch and open a pull request:"
                    echo "  git checkout -b feature/my-change"
                    echo "  git push -u origin feature/my-change"
                    echo "  gh pr create"
                    exit 1
                  fi
                  """
            }
        }
    }
}
```

**mise.toml additions:**
```toml
[tools]
hk = "latest"
pkl = "latest"
typos = "latest"
gitleaks = "latest"
rumdl = "latest"
yamllint = "latest"
```

---

## Dotfiles (Shell + Nix)

No package.json. Uses local variable to share steps across pre-commit/fix/check hooks. No JS tools — focused on shell, nix, and markdown.

```pkl
// Dotfiles hk configuration - fast pre-commit checks for staged files.
amends "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Builtins.pkl"

exclude = List(".git", "git", "node_modules", ".cache", ".local", ".npm", ".cargo", ".rustup", ".vscode-server")

display_skip_reasons = List()
terminal_progress = false

local fast_steps = new Mapping<String, Step> {
    ["trailing-whitespace"] = (Builtins.trailing_whitespace) {}
    ["newlines"] = (Builtins.newlines) {}
    ["check-merge-conflict"] = (Builtins.check_merge_conflict) {}

    ["shfmt"] = (Builtins.shfmt) {
        batch = true
    }

    ["shellcheck"] = (Builtins.shellcheck) {
        batch = true
    }

    ["zsh-syntax"] {
        glob = List(".zshrc", ".zprofile", ".zshenv", ".config/zsh/functions/**")
        check = "zsh -n {{files}}"
    }

    ["nixfmt"] = (Builtins.nix_fmt) {
        batch = true
    }

    ["rumdl"] = (Builtins.rumdl) {
        batch = true
    }

    ["mise"] = Builtins.mise
}

hooks {
    ["pre-commit"] {
        fix = true
        stash = "git"
        steps = fast_steps
    }

    ["fix"] {
        fix = true
        stash = "git"
        steps = fast_steps
    }

    ["check"] {
        steps = fast_steps
    }
}
```

**mise.toml additions:**
```toml
[tools]
hk = "latest"
pkl = "latest"
rumdl = "latest"
```

**Installation** (no `prepare` script — set manually once):
```bash
git config --local core.hooksPath .hk-hooks
```

---

## Go Service

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Builtins.pkl"

display_skip_reasons = List()
terminal_progress = false

hooks {
    ["pre-commit"] {
        fix = true
        stash = "git"
        steps {
            ["trailing-whitespace"] = (Builtins.trailing_whitespace) {}
            ["newlines"] = (Builtins.newlines) {}
            ["check-merge-conflict"] = (Builtins.check_merge_conflict) {}
            ["typos"] = (Builtins.typos) {
                exclude = List("go.sum")
            }
            ["gitleaks"] {
                check = "scripts/quiet-on-success.sh gitleaks detect --no-banner --redact --log-level=error"
            }
            ["go-fmt"] = (Builtins.go_fmt) {}
            ["go-vet"] = (Builtins.go_vet) {}
            ["golangci-lint"] = (Builtins.golangci_lint) {}
            ["go-test"] {
                check = "scripts/quiet-on-success.sh go test ./..."
            }
        }
    }
}
```

**mise.toml additions:**
```toml
[tools]
hk = "latest"
pkl = "latest"
typos = "latest"
gitleaks = "latest"
```

---

## Python (ruff + mypy)

```pkl
amends "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.36.0/hk@1.36.0#/Builtins.pkl"

exclude = List(".venv", "__pycache__", ".mypy_cache", ".ruff_cache", "dist")

display_skip_reasons = List()
terminal_progress = false

hooks {
    ["pre-commit"] {
        fix = true
        stash = "git"
        steps {
            ["trailing-whitespace"] = (Builtins.trailing_whitespace) {}
            ["newlines"] = (Builtins.newlines) {}
            ["check-merge-conflict"] = (Builtins.check_merge_conflict) {}
            ["typos"] = (Builtins.typos) {}
            ["gitleaks"] {
                check = "scripts/quiet-on-success.sh gitleaks detect --no-banner --redact --log-level=error"
            }
            ["ruff-format"] = (Builtins.ruff_format) {}
            ["ruff"] = (Builtins.ruff) {}
            ["mypy"] = (Builtins.mypy) { stomp = true }
            ["pytest"] {
                check = "scripts/quiet-on-success.sh pytest"
            }
        }
    }
}
```

**mise.toml additions:**
```toml
[tools]
hk = "latest"
pkl = "latest"
typos = "latest"
gitleaks = "latest"
```
