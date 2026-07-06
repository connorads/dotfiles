#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

DOTFILES="$FUNCTIONS_DIR/git/dotfiles"

dfgit() {
  git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" "$@"
}

setup() {
  setup_test_home

  mkdir -p "$HOME/git" "$HOME/.codex"
  git init --quiet --separate-git-dir="$HOME/git/dotfiles" "$HOME"
  dfgit config user.email "tester@users.noreply.github.com"
  dfgit config user.name "Dotfiles Test"
  dfgit config filter.codex-config.clean "$FUNCTIONS_DIR/codex-config-clean"
  dfgit config filter.codex-config.smudge cat
  dfgit config filter.codex-config.required true

  printf '.codex/config.toml filter=codex-config\n' >"$HOME/.gitattributes"
  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "medium"
EOF

  dfgit add .gitattributes .codex/config.toml
  dfgit commit -qm init
}

@test "status hides stripped codex blocks without staging" {
  cat >>"$HOME/.codex/config.toml" <<'EOF'

[projects."/Users/connorads"]
trust_level = "trusted"
EOF

  run "$DOTFILES" status --short .codex/config.toml

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
  dfgit diff --cached --quiet -- .codex/config.toml
}

@test "status leaves real codex config edits unstaged" {
  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "xhigh"

[projects."/Users/connorads"]
trust_level = "trusted"
EOF

  run "$DOTFILES" status --short .codex/config.toml

  [ "$status" -eq 0 ]
  [ "$output" = " M .codex/config.toml" ]
  dfgit diff --cached --quiet -- .codex/config.toml

  run dfgit diff -- .codex/config.toml
  [[ "$output" == *'model_reasoning_effort = "xhigh"'* ]]
}

@test "status preserves staged codex edits while hiding stripped worktree noise" {
  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
EOF
  dfgit add .codex/config.toml

  cat >>"$HOME/.codex/config.toml" <<'EOF'

[projects."/Users/connorads"]
trust_level = "trusted"
EOF

  run "$DOTFILES" status --short .codex/config.toml

  [ "$status" -eq 0 ]
  [ "$output" = "M  .codex/config.toml" ]
  dfgit diff --quiet -- .codex/config.toml

  run dfgit diff --cached -- .codex/config.toml
  [[ "$output" == *'model_reasoning_effort = "xhigh"'* ]]
}
