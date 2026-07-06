#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

GUARD="$HOME/.hk-hooks/claude-profile-leak-guard.py"

setup() {
  setup_test_home
  export REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO/.hk-hooks"
  cp "$GUARD" "$REPO/.hk-hooks/claude-profile-leak-guard.py"
  cd "$REPO" || exit
  git init -q
  git config user.email test@example.com
  git config user.name Test
}

run_guard() {
  run python3 .hk-hooks/claude-profile-leak-guard.py
}

@test "guard allows generic tracked launcher patterns" {
  mkdir -p .config/zsh/functions
  cat >.config/zsh/functions/claude-code-profile <<'EOF'
env \
  -u ANTHROPIC_API_KEY \
  -u ANTHROPIC_AUTH_TOKEN \
  -u CLAUDE_CODE_OAUTH_TOKEN \
  CLAUDE_CONFIG_DIR="$HOME/.claude-profiles/code/$name" \
  claude "$@"
EOF
  git add .config/zsh/functions/claude-code-profile

  run_guard

  [ "$status" -eq 0 ]
}

@test "guard blocks staged zshrc.local even when forced" {
  echo "alias ccw='claude-code-profile work'" >.zshrc.local
  git add -f .zshrc.local

  run_guard

  [ "$status" -eq 1 ]
  [[ "$output" == *"staged local-only path: .zshrc.local"* ]]
}

@test "guard blocks staged private profile aliases" {
  cat >README.md <<'EOF'
Run this locally:
alias ccw='claude-code-profile work'
EOF
  git add README.md

  run_guard

  [ "$status" -eq 1 ]
  [[ "$output" == *"staged concrete Claude profile alias/call"* ]]
}

@test "guard blocks staged concrete profile paths" {
  cat >README.md <<'EOF'
open -n -a /Applications/Claude.app --args --user-data-dir="$HOME/.claude-profiles/desktop/work"
EOF
  git add README.md

  run_guard

  [ "$status" -eq 1 ]
  [[ "$output" == *"staged concrete .claude-profiles path"* ]]
}

@test "guard blocks staged Anthropic token patterns" {
  echo 'ANTHROPIC_API_KEY=sk-ant-testtoken' >README.md
  git add README.md

  run_guard

  [ "$status" -eq 1 ]
  [[ "$output" == *"staged Anthropic token pattern"* ]]
  [[ "$output" == *"staged Claude auth env assignment"* ]]
}
