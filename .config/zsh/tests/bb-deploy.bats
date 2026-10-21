#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
source "$BATS_TEST_DIRNAME/test_helper.bash"

DEPLOY="$FUNCTIONS_DIR/agents/bb-deploy"

setup() {
  local jq_dir
  jq_dir="$(dirname "$(command -v jq)")"
  setup_test_home
  export PATH="$PATH:$jq_dir"
  export DEPLOY_ROOT="$HOME/.config/bb/deployment"
  export NODE_DIR="$HOME/tools/node" BB_DIR="$HOME/tools/bb"
  mkdir -p "$NODE_DIR/bin" "$BB_DIR/node_modules/bb-app" "$BB_DIR/node_modules/.bin"
  printf '{"version":"0.46.1"}\n' >"$BB_DIR/node_modules/bb-app/package.json"
  write_stub mise <<'EOF'
#!/usr/bin/env bash
echo "mise $*" >>"$TEST_LOG"
case "$*" in
  *'current node') echo 24.22.0 ;;
  *'current npm:bb-app') echo 0.46.1 ;;
  *'where node') [ "${MISSING_NODE:-0}" = 0 ] || exit 1; echo "$NODE_DIR" ;;
  *'where npm:bb-app') echo "$BB_DIR" ;;
esac
EOF
  cat >"$NODE_DIR/bin/node" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = --version ]; then echo v24.22.0; exit 0; fi
cat >/dev/null
exit "${NATIVE_EXIT:-0}"
EOF
  chmod +x "$NODE_DIR/bin/node"
  cat >"$BB_DIR/node_modules/.bin/bb-app" <<'EOF'
#!/usr/bin/env bash
echo "bb-app $*" >>"$TEST_LOG"
EOF
  chmod +x "$BB_DIR/node_modules/.bin/bb-app"
  write_stub curl <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >>"$TEST_LOG"
case "$*" in
  *'/threads/running')
    [ "${IDLE_EXIT:-0}" = 0 ] || exit "$IDLE_EXIT"
    if [ -f "$HOME/tasks-started" ]; then echo '[{"id":"new-task"}]'; exit 0; fi
    echo "${RUNNING_JSON:-[]}"
    ;;
  *'/system/app-update') printf '{"current":{"version":"%s"}}\n' "${LIVE_VERSION:-0.46.1}" ;;
  *'/system/config') echo '{"primaryHostId":"host-local"}' ;;
  *'/hosts') echo '[{"id":"host-local","status":"connected"}]' ;;
  *'/health') echo '{"ok":true}' ;;
  *'/server/export')
    [ "${BACKUP_EXIT:-0}" = 0 ] || exit "$BACKUP_EXIT"
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --output ]; then shift; tar -czf "$1" -C "$HOME" backup-fixture; fi
      shift
    done
    [ "${AFTER_BACKUP_BUSY:-0}" = 0 ] || touch "$HOME/tasks-started"
    ;;
esac
EOF
  echo 'backup data' >"$HOME/backup-fixture"
  write_stub sudo <<'EOF'
#!/usr/bin/env bash
echo "sudo $*" >>"$TEST_LOG"
exit "${SUDO_EXIT:-0}"
EOF
}

prepare() {
  zsh --no-rcs "$DEPLOY" prepare
}

adopt() {
  prepare || return 1
  zsh --no-rcs "$DEPLOY" adopt
}

older_deployment() {
  adopt || return 1
  printf '[tools]\nnode = "24.22.0"\n"npm:bb-app" = "0.46.0"\n' >"$DEPLOY_ROOT/current/mise.toml"
}

render_launcher() {
  command -v nix >/dev/null || skip 'Nix required to render bb-service-launcher.nix'
  export BB_LAUNCHER_SOURCE="$BATS_TEST_DIRNAME/../../nix/modules/bb-service-launcher.nix"
  export BB_FAKE_MISE="$HOME/pkgs" BB_FAKE_JQ
  BB_FAKE_JQ="$(dirname "$(dirname "$(command -v jq)")")"
  mkdir -p "$BB_FAKE_MISE/bin" "$HOME/.config/bb" "$HOME/.config/telemetry"
  ln -s "$TEST_BIN/mise" "$BB_FAKE_MISE/bin/mise"
  printf '{"server":{"enabled":true}}\n' >"$HOME/.config/bb/services.local.json"
  : >"$HOME/.config/telemetry/environment.sh"
  nix eval --raw --impure --expr '
    import (builtins.toPath (builtins.getEnv "BB_LAUNCHER_SOURCE")) {
      deployedServer = true;
      pkgs = {
        writeShellScript = _: text: text;
        lib.optionalString = condition: text: if condition then text else "";
        mise = builtins.getEnv "BB_FAKE_MISE";
        jq = builtins.getEnv "BB_FAKE_JQ";
      };
    }
  ' >"$HOME/launcher"
}

@test "deployed launcher refuses missing pins instead of falling back to global tools" {
  render_launcher
  run "$BASH5" "$HOME/launcher" server
  [ "$status" -ne 0 ]
  [[ "$output" == *'deployed pins missing'* ]]
  ! grep -q '^mise ' "$TEST_LOG"
}

@test "deployed launcher uses current pins and disables independent updates" {
  adopt
  render_launcher
  : >"$TEST_LOG"
  run "$BASH5" "$HOME/launcher" server
  [ "$status" -eq 0 ]
  grep -q "mise -C $DEPLOY_ROOT/current where node" "$TEST_LOG"
  grep -q "mise -C $DEPLOY_ROOT/current where npm:bb-app" "$TEST_LOG"
  grep -q 'bb-app --server-bind-host 127.0.0.1 --no-in-app-updates' "$TEST_LOG"
}

@test "prepare pins installed BB and Node without restarting" {
  run prepare
  [ "$status" -eq 0 ]
  [ -f "$DEPLOY_ROOT/candidate/mise.toml" ]
  grep -q '24.22.0' "$DEPLOY_ROOT/candidate/mise.toml"
  grep -q '0.46.1' "$DEPLOY_ROOT/candidate/mise.toml"
  [ ! -e "$DEPLOY_ROOT/current/mise.toml" ]
  ! grep -q '^sudo ' "$TEST_LOG"
}

@test "missing desired installation leaves deployed pins unchanged" {
  adopt
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  export MISSING_NODE=1
  run prepare
  [ "$status" -ne 0 ]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
}

@test "native module failure prevents candidate preparation" {
  export NATIVE_EXIT=1
  run prepare
  [ "$status" -ne 0 ]
  [ ! -e "$DEPLOY_ROOT/candidate/mise.toml" ]
}

@test "adopt refuses a different running release" {
  prepare
  export LIVE_VERSION=0.45.0
  run zsh --no-rcs "$DEPLOY" adopt
  [ "$status" -ne 0 ]
  [ ! -e "$DEPLOY_ROOT/current/mise.toml" ]
}

@test "adopt records the current release without restarting or overwriting it" {
  run adopt
  [ "$status" -eq 0 ]
  [ -f "$DEPLOY_ROOT/current/mise.toml" ]
  ! grep -q '^sudo ' "$TEST_LOG"
  run zsh --no-rcs "$DEPLOY" adopt
  [ "$status" -ne 0 ]
}

@test "another deployment holds the lock" {
  mkdir -p "$DEPLOY_ROOT/.lock"
  run prepare
  [ "$status" -ne 0 ]
  [ -d "$DEPLOY_ROOT/.lock" ]
}

@test "busy tasks defer activation before backup or privilege checks" {
  older_deployment
  export RUNNING_JSON='[{"id":"hidden-task","hostId":"host-local"}]'
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 75 ]
  ! grep -q '^sudo ' "$TEST_LOG"
  ! grep -q '/server/export' "$TEST_LOG"
}

@test "unavailable or malformed task state defers activation" {
  older_deployment
  export RUNNING_JSON='{"error":"not an array"}'
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 75 ]
  ! grep -q '^sudo ' "$TEST_LOG"
  export IDLE_EXIT=22
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 75 ]
}

@test "failed backup leaves selection unchanged and never restarts" {
  older_deployment
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  export BACKUP_EXIT=22
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -ne 0 ]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  ! grep -q kickstart "$TEST_LOG"
}

@test "activation retains pins, validates backup, and restarts the system daemon" {
  older_deployment
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 0 ]
  [ -f "$DEPLOY_ROOT/previous/mise.toml" ]
  grep -q 'kickstart -k system/org.nixos.bb-server' "$TEST_LOG"
  find "$HOME/.local/state/bb-deploy/backups" -name '*.tar.gz' | grep -q .
}

@test "unchanged deployment never restarts BB" {
  adopt
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 0 ]
  ! grep -q '^sudo ' "$TEST_LOG"
}

@test "task arriving during backup defers before changing deployed pins" {
  older_deployment
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  export AFTER_BACKUP_BUSY=1
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 75 ]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  ! grep -q kickstart "$TEST_LOG"
}

@test "missing sudo authentication leaves deployed pins unchanged" {
  older_deployment
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  export SUDO_EXIT=1
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -ne 0 ]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  ! grep -q '/server/export' "$TEST_LOG"
}

@test "unknown command fails before modifying deployment state" {
  run zsh --no-rcs "$DEPLOY" restart
  [ "$status" -eq 2 ]
  [ ! -d "$DEPLOY_ROOT" ]
}
