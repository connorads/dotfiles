#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

DOTFILES="$FUNCTIONS_DIR/git/dotfiles"

dfgit() {
  git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" "$@"
}

setup() {
  setup_test_home

  mkdir -p "$HOME/git" "$HOME/.codex" "$HOME/.pi/agent"
  git init --quiet --separate-git-dir="$HOME/git/dotfiles" "$HOME"
  dfgit config user.email "tester@users.noreply.github.com"
  dfgit config user.name "Dotfiles Test"
  dfgit config filter.codex-config.clean "$FUNCTIONS_DIR/codex-config-clean"
  dfgit config filter.codex-config.smudge cat
  dfgit config filter.codex-config.required true
  dfgit config filter.pi-agent-settings.clean "$FUNCTIONS_DIR/pi-agent-settings-clean"
  dfgit config filter.pi-agent-settings.smudge cat
  dfgit config filter.pi-agent-settings.required true

  printf '.codex/config.toml filter=codex-config\n.pi/agent/settings.json filter=pi-agent-settings\n' >"$HOME/.gitattributes"
  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "medium"
tool_output_token_limit = 25000
plan_mode_reasoning_effort = "high"
EOF
  cat >"$HOME/.pi/agent/settings.json" <<'EOF'
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.5",
  "defaultThinkingLevel": "high",
  "theme": "dark"
}
EOF

  dfgit add .gitattributes .codex/config.toml .pi/agent/settings.json
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
model_reasoning_effort = "medium"
tool_output_token_limit = 12000

[projects."/Users/connorads"]
trust_level = "trusted"
EOF

  run "$DOTFILES" status --short .codex/config.toml

  [ "$status" -eq 0 ]
  [ "$output" = " M .codex/config.toml" ]
  dfgit diff --cached --quiet -- .codex/config.toml

  run dfgit diff -- .codex/config.toml
  [[ "$output" == *'tool_output_token_limit = 12000'* ]]
}

@test "status hides codex model picker churn" {
  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.4"
model_reasoning_effort = "xhigh"
tool_output_token_limit = 25000
plan_mode_reasoning_effort = "xhigh"

[projects."/Users/connorads"]
trust_level = "trusted"
EOF

  run "$DOTFILES" status --short .codex/config.toml

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
  dfgit diff --cached --quiet -- .codex/config.toml
}

@test "status hides codex desktop and app-injected mcp churn" {
  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "medium"
tool_output_token_limit = 25000
plan_mode_reasoning_effort = "high"

[desktop]
followUpQueueMode = "queue"

[hooks.state]
EOF
  dfgit add .codex/config.toml
  dfgit commit -qm codex-desktop-baseline

  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "medium"
tool_output_token_limit = 25000
plan_mode_reasoning_effort = "high"

[desktop]
followUpQueueMode = "queue"
dock-icon-preference = "codex-system"

[hooks.state]

[mcp_servers.computer-use]
command = "./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"
args = ["mcp"]
cwd = "."
enabled = false
EOF

  run "$DOTFILES" status --short .codex/config.toml

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
  dfgit diff --cached --quiet -- .codex/config.toml
}

@test "status hides pi model picker churn and missing final newline" {
  printf '%s' '{
  "defaultProvider": "cosine",
  "defaultModel": "claude-opus-4-8",
  "defaultThinkingLevel": "xhigh",
  "theme": "dark"
}' >"$HOME/.pi/agent/settings.json"

  run "$DOTFILES" status --short .pi/agent/settings.json

  [ "$status" -eq 0 ]
  [ "$output" = "" ]
  dfgit diff --cached --quiet -- .pi/agent/settings.json
}

@test "status leaves real pi settings edits unstaged" {
  cat >"$HOME/.pi/agent/settings.json" <<'EOF'
{
  "defaultProvider": "cosine",
  "defaultModel": "claude-opus-4-8",
  "defaultThinkingLevel": "xhigh",
  "theme": "light"
}
EOF

  run "$DOTFILES" status --short .pi/agent/settings.json

  [ "$status" -eq 0 ]
  [ "$output" = " M .pi/agent/settings.json" ]
  dfgit diff --cached --quiet -- .pi/agent/settings.json

  run dfgit diff -- .pi/agent/settings.json
  [[ "$output" == *'"theme": "light"'* ]]
}

@test "status preserves staged codex edits while hiding stripped worktree noise" {
  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "medium"
tool_output_token_limit = 12000
EOF
  dfgit add .codex/config.toml

  cat >"$HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.4"
model_reasoning_effort = "xhigh"
tool_output_token_limit = 12000

[projects."/Users/connorads"]
trust_level = "trusted"
EOF

  run "$DOTFILES" status --short .codex/config.toml

  [ "$status" -eq 0 ]
  [ "$output" = "M  .codex/config.toml" ]
  dfgit diff --quiet -- .codex/config.toml

  run dfgit diff --cached -- .codex/config.toml
  [[ "$output" == *'tool_output_token_limit = 12000'* ]]
}
