# Complete hk.pkl Examples

## Contents

- Astro + Preact + Tailwind + pnpm
- Payload CMS + Next.js 15 + Biome + pnpm
- Dotfiles (Shell + Nix)
- Go Service
- Python (ruff + mypy)

V2 examples verified against 2.0.1 on 2026-09-20. Match the schema URLs to the
selected installed release. For v1 maintenance read `versions-and-migration.md`.

These explicit hooks retain distinct memberships. Most define only pre-commit;
`hk check` needs an explicit check hook or shared top-level steps. Preview with
`hk run pre-commit --plan` before running a fixing hook. Keep new common checks
in top-level steps only when all three default hooks should receive them.

---

## Astro + Preact + Tailwind + pnpm

9 pre-commit steps. Simple setup - no commit-msg or pre-push hooks needed.

```pkl
// hk configuration - https://hk.jdx.dev/
amends "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Builtins.pkl"

exclude = List("node_modules", "dist", ".wrangler")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet success output with `hk run -q` - see references/output-noise.md

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
                check = "pnpm exec prettier --check {{files}}"
                fix = "pnpm exec prettier --write {{files}}"
            }
            ["eslint"] {
                glob = List("*.ts", "*.tsx", "*.js", "*.mjs", "*.astro")
                check = "pnpm exec eslint {{files}}"
                fix = "pnpm exec eslint --fix {{files}}"
            }

            // Validation
            ["check-merge-conflict"] = (Builtins.check_merge_conflict) {}
            ["gitleaks"] {
                check = "gitleaks detect --no-banner --redact --log-level=error"  // silent on success
            }
            ["typecheck"] {
                check = "pnpm exec astro check"
            }
            ["vitest"] {
                check = "pnpm exec vitest run"
            }
        }
    }
}
```

**mise.toml additions:**

```toml
[tools]
hk = "2"
typos = "latest"
gitleaks = "latest"
```

---

## Payload CMS + Next.js 15 + Biome + pnpm

Pre-commit checks and a separate commit-msg hook. Comprehensive setup for a team repo. Add
the soft-protected pre-push asset when advisory branch push protection is needed.

```pkl
// hk configuration - https://hk.jdx.dev/
amends "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Builtins.pkl"

exclude = List("node_modules", "dist", ".next", ".open-next", "storybook-static")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet success output with `hk run -q` - see references/output-noise.md

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
                check = "pnpm exec ultracite check --error-on-warnings=true {{files}}"
                fix = "pnpm exec ultracite fix {{files}}"
            }
            ["eslint"] {
                glob = List("*.ts", "*.tsx", "*.js", "*.jsx")
                check = "pnpm exec eslint {{files}}"
                fix = "pnpm exec eslint --fix {{files}}"
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
                check = "gitleaks detect --no-banner --redact --log-level=error"  // silent on success
            }
            ["check-migrations"] {
                glob = List("src/collections/*", "src/blocks/*", "src/globals/*", "payload.config.ts")
                check = "pnpm check:migrations"
            }
            ["typecheck"] {
                check = "pnpm typecheck:fast"
            }

            // Tests
            ["test-unit"] {
                check = "pnpm test:unit:coverage"
            }
            ["test-int"] {
                check = "pnpm test:int:coverage"
            }
            ["test-components"] {
                check = "pnpm test:components"
            }
            ["lint-stories"] {
                check = "pnpm lint:stories"
            }
            ["test-storybook"] {
                check = "pnpm test:storybook:ci"
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
}
```

For advisory local push protection, copy
`assets/soft-protected-branch-pre-push.sh` to `.hk-hooks/pre-push`. It blocks by
the remote ref Git is about to update and supports clone-local owner opt-out.

**mise.toml additions:**

```toml
[tools]
hk = "2"
typos = "latest"
gitleaks = "latest"
rumdl = "latest"
yamllint = "latest"
```

---

## Dotfiles (Shell + Nix)

No package.json. Explicit hooks share a local mapping. This example's fix hook
stashes and stages by design, so it declares `stage = true` in v2. A new manual
fix workflow normally leaves fixes unstaged.

```pkl
// Dotfiles hk configuration - fast pre-commit checks for staged files.
amends "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Builtins.pkl"

exclude = List(".git", "git", "node_modules", ".cache", ".local", ".npm", ".cargo", ".rustup", ".vscode-server")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet success output with `hk run -q` - see references/output-noise.md

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
        stage = true
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
hk = "2"
rumdl = "latest"
```

**Installation** (no `prepare` script - set manually once):

```bash
git config --local core.hooksPath .hk-hooks
```

---

## Go Service

```pkl
amends "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Builtins.pkl"

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet success output with `hk run -q` - see references/output-noise.md

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
                check = "gitleaks detect --no-banner --redact --log-level=error"  // silent on success
            }
            ["go-fmt"] = (Builtins.go_fmt) {}
            ["go-vet"] = (Builtins.go_vet) {}
            ["golangci-lint"] = (Builtins.golangci_lint) {}
            ["go-test"] {
                check = "go test ./..."
            }
        }
    }
}
```

**mise.toml additions:**

```toml
[tools]
hk = "2"
typos = "latest"
gitleaks = "latest"
```

---

## Python (ruff + mypy)

```pkl
amends "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v2.0.1/hk@2.0.1#/Builtins.pkl"

exclude = List(".venv", "__pycache__", ".mypy_cache", ".ruff_cache", "dist")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet success output with `hk run -q` - see references/output-noise.md

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
                check = "gitleaks detect --no-banner --redact --log-level=error"  // silent on success
            }
            ["ruff-format"] = (Builtins.ruff_format) {}   // builtin passes --quiet (silent)
            ["ruff"] = Builtins.ruff
            ["mypy"] = Builtins.mypy
            ["pytest"] {
                check = "pytest"   // chatty on success; wrapper-level -q drops it
            }
        }
    }
}
```

**mise.toml additions:**

```toml
[tools]
hk = "2"
typos = "latest"
gitleaks = "latest"
```
