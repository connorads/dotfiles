# Complete hk.pkl Examples

Real configurations for different tech stacks. Bump the version in the `amends`/`import` URLs to match `hk --version`.

---

## Astro + Preact + Tailwind + pnpm

9 pre-commit steps. Simple setup — no commit-msg or pre-push hooks needed.

```pkl
// hk configuration - https://hk.jdx.dev/
amends "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Builtins.pkl"

exclude = List("node_modules", "dist", ".wrangler")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet steps at the source — see references/output-noise.md

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
                check = "scripts/quiet-on-success.sh pnpm exec prettier --check {{files}}"  // prints on success; wrapper suppresses it
                fix = "scripts/quiet-on-success.sh pnpm exec prettier --write {{files}}"
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
                check = "scripts/quiet-on-success.sh pnpm exec astro check"  // prints result summary; wrapper suppresses it
            }
            ["vitest"] {
                check = "scripts/quiet-on-success.sh pnpm exec vitest run"  // prints on success; wrapper suppresses it
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

16 pre-commit steps + commit-msg hook. Comprehensive setup for a team repo. Add
the soft-protected pre-push asset when advisory branch push protection is needed.

```pkl
// hk configuration - https://hk.jdx.dev/
amends "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Builtins.pkl"

exclude = List("node_modules", "dist", ".next", ".open-next", "storybook-static")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet steps at the source — see references/output-noise.md

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
                check = "scripts/quiet-on-success.sh pnpm exec ultracite check --error-on-warnings=true {{files}}"  // prints success summary; wrapper suppresses it
                fix = "scripts/quiet-on-success.sh pnpm exec ultracite fix {{files}}"
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
}
```

For advisory local push protection, copy
`assets/soft-protected-branch-pre-push.sh` to `.hk-hooks/pre-push`. It blocks by
the remote ref Git is about to update and supports clone-local owner opt-out.

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
amends "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Builtins.pkl"

exclude = List(".git", "git", "node_modules", ".cache", ".local", ".npm", ".cargo", ".rustup", ".vscode-server")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet steps at the source — see references/output-noise.md

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
amends "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Builtins.pkl"

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet steps at the source — see references/output-noise.md

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
                check = "scripts/quiet-on-success.sh go test ./..."   // prints on success; wrapper suppresses it
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
amends "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Config.pkl"
import "package://github.com/jdx/hk/releases/download/v1.48.0/hk@1.48.0#/Builtins.pkl"

exclude = List(".venv", "__pycache__", ".mypy_cache", ".ruff_cache", "dist")

display_skip_reasons = List()   // suppress skip noise
terminal_progress = false        // OSC progress sequences, not stdout noise; quiet steps at the source — see references/output-noise.md

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
            ["ruff"] = (Builtins.ruff) {
                check = "ruff check -q --force-exclude {{files}}"   // -q silences `All checks passed!` (tier 2)
            }
            ["mypy"] = (Builtins.mypy) { stomp = true }
            ["pytest"] {
                check = "scripts/quiet-on-success.sh pytest"   // prints on success; wrapper suppresses it
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
