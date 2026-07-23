#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

MCPZ="$FUNCTIONS_DIR/agents/mcpz"

setup() {
  setup_test_home
  export MCPZ_REGISTRY="$BATS_TEST_TMPDIR/registry.json"
  cat >"$MCPZ_REGISTRY" <<'JSON'
{
  "version": 1,
  "bundles": {
    "web": {
      "servers": {
        "gw": {
          "transport": "http",
          "url": "http://localhost:4789/mcp/toolkits/gw",
          "headers": { "X-Env": "prod" },
          "bearer": { "secret": "GW_TOKEN" },
          "secrets": { "GW_TOKEN": { "cmd": "printf %s tok123" } }
        }
      }
    },
    "local": {
      "servers": {
        "fs": {
          "transport": "stdio",
          "command": "npx",
          "args": ["-y", "server-fs", "/data"],
          "env": { "FS_ROOT": "/data" }
        }
      }
    }
  }
}
JSON
}

run_mcpz() { run_zsh_function "$MCPZ" "$@"; }

# --- list ---

@test "list prints bundle names, one per line" {
  run_mcpz list
  [ "$status" -eq 0 ]
  [[ "$output" == *"web"* ]]
  [[ "$output" == *"local"* ]]
}

@test "list --json emits a JSON array of bundle names" {
  run_mcpz list --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e 'index("web") and index("local")'
}

@test "no args non-interactively defaults to list" {
  run_mcpz
  [ "$status" -eq 0 ]
  [[ "$output" == *"web"* ]]
}

# --- show + redaction ---

@test "show lists servers with secret NAME but redacts values" {
  run_mcpz show web
  [ "$status" -eq 0 ]
  [[ "$output" == *"server: gw"* ]]
  [[ "$output" == *"transport: http"* ]]
  [[ "$output" == *"secret: GW_TOKEN"* ]]
  [[ "$output" == *"bearer: [redacted]"* ]]
  [[ "$output" == *"header: X-Env: [redacted]"* ]]
  # literal header value must never surface
  [[ "$output" != *"prod"* ]]
}

# --- render: claude ---

@test "render claude http: inline mcp-config + strict flag, bearer as \${VAR}" {
  run_mcpz render claude web
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | sed -n '1p')" = "--mcp-config" ]
  [ "$(echo "$output" | sed -n '3p')" = "--strict-mcp-config" ]
  local json
  json=$(echo "$output" | sed -n '2p')
  echo "$json" | jq -e '.mcpServers.gw.type == "http"'
  echo "$json" | jq -e '.mcpServers.gw.url == "http://localhost:4789/mcp/toolkits/gw"'
  echo "$json" | jq -e '.mcpServers.gw.headers.Authorization == "Bearer ${GW_TOKEN}"'
  echo "$json" | jq -e '.mcpServers.gw.headers["X-Env"] == "prod"'
  # resolved secret value must not leak into a pure render
  [[ "$output" != *"tok123"* ]]
}

@test "render cc alias equals render claude" {
  run_mcpz render cc web
  local a="$output"
  run_mcpz render claude web
  [ "$a" = "$output" ]
}

@test "render claude stdio: type stdio, command, args, env" {
  run_mcpz render claude local
  [ "$status" -eq 0 ]
  local json
  json=$(echo "$output" | sed -n '2p')
  echo "$json" | jq -e '.mcpServers.fs.type == "stdio"'
  echo "$json" | jq -e '.mcpServers.fs.command == "npx"'
  echo "$json" | jq -e '.mcpServers.fs.args == ["-y","server-fs","/data"]'
  echo "$json" | jq -e '.mcpServers.fs.env.FS_ROOT == "/data"'
}

# --- render: codex ---

@test "render codex http: url + bearer_token_env_var as -c pairs" {
  run_mcpz render codex web
  [ "$status" -eq 0 ]
  [[ "$output" == *"-c"* ]]
  [[ "$output" == *'mcp_servers.gw.url="http://localhost:4789/mcp/toolkits/gw"'* ]]
  [[ "$output" == *'mcp_servers.gw.bearer_token_env_var="GW_TOKEN"'* ]]
  [[ "$output" == *'mcp_servers.gw.http_headers.X-Env="prod"'* ]]
  [[ "$output" != *"tok123"* ]]
}

@test "render codex stdio: command, args array, env inline table" {
  run_mcpz render codex local
  [ "$status" -eq 0 ]
  [[ "$output" == *'mcp_servers.fs.command="npx"'* ]]
  [[ "$output" == *'mcp_servers.fs.args=["-y","server-fs","/data"]'* ]]
  [[ "$output" == *'mcp_servers.fs.env={ FS_ROOT = "/data" }'* ]]
}

# --- render: opencode ---

@test "render opencode http: remote server, {env:VAR} header ref" {
  run_mcpz render oc web
  [ "$status" -eq 0 ]
  [[ "$output" == *"OPENCODE_DISABLE_PROJECT_CONFIG=1"* ]]
  local json
  json=$(echo "$output" | tail -n1)
  echo "$json" | jq -e '.mcp.gw.type == "remote"'
  echo "$json" | jq -e '.mcp.gw.enabled == true'
  echo "$json" | jq -e '.mcp.gw.headers.Authorization == "Bearer {env:GW_TOKEN}"'
  echo "$json" | jq -e '.mcp.gw.headers["X-Env"] == "prod"'
  [[ "$output" != *"tok123"* ]]
}

@test "render opencode stdio: local server, command array, environment" {
  run_mcpz render opencode local
  [ "$status" -eq 0 ]
  local json
  json=$(echo "$output" | tail -n1)
  echo "$json" | jq -e '.mcp.fs.type == "local"'
  echo "$json" | jq -e '.mcp.fs.command == ["npx","-y","server-fs","/data"]'
  echo "$json" | jq -e '.mcp.fs.environment.FS_ROOT == "/data"'
}

# --- error paths ---

@test "unknown bundle returns 2" {
  run_mcpz render claude nope
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown bundle 'nope'"* ]]
}

@test "unknown agent returns 2" {
  run_mcpz render banana web
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown agent 'banana'"* ]]
}

@test "render without args returns 2" {
  run_mcpz render claude
  [ "$status" -eq 2 ]
}

@test "show without a bundle returns 2" {
  run_mcpz show
  [ "$status" -eq 2 ]
}

@test "unknown subcommand returns 2" {
  run_mcpz frobnicate
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown subcommand 'frobnicate'"* ]]
}

@test "missing registry errors cleanly" {
  MCPZ_REGISTRY="$BATS_TEST_TMPDIR/absent.json" run_mcpz list
  [ "$status" -eq 1 ]
  [[ "$output" == *"registry not found"* ]]
}

@test "pick without fzf on PATH errors gracefully" {
  # The nix bin dir (kept on PATH so zsh resolves) also ships fzf, which would
  # launch interactively and hang. Use system zsh with a PATH that excludes it.
  local sys_zsh
  sys_zsh=$(PATH=/bin:/usr/bin command -v zsh)
  PATH="$TEST_BIN:/bin:/usr/bin" run "$sys_zsh" --no-rcs "$MCPZ" pick
  [ "$status" -eq 1 ]
  [[ "$output" == *"fzf required"* ]]
}
