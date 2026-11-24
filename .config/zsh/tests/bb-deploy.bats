#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
source "$BATS_TEST_DIRNAME/test_helper.bash"

DEPLOY="$FUNCTIONS_DIR/agents/bb-deploy"

setup() {
  local jq_dir
  jq_dir="$(dirname "$(command -v jq)")"
  export BB_REAL_NODE
  BB_REAL_NODE=$(node -p process.execPath)
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
  'config get --file '*env.BB_DEPLOY_SERVICE) value=$(grep '^BB_DEPLOY_SERVICE = ' "$4") || exit 1; printf '%s\n' "$value" | cut -d '"' -f2 ;;
  'config get --file '*env.BB_DEPLOY_PACKAGE) value=$(grep '^BB_DEPLOY_PACKAGE = ' "$4") || exit 1; printf '%s\n' "$value" | cut -d '"' -f2 ;;
  *'current node') echo 24.22.0 ;;
  *'current npm:bb-app') echo 0.46.1 ;;
  *'where node') [ "${MISSING_NODE:-0}" = 0 ] || exit 1; echo "$NODE_DIR" ;;
  *'where npm:bb-app') echo "$BB_DIR" ;;
esac
EOF
  cat >"$NODE_DIR/bin/node" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = --version ]; then echo v24.22.0; exit 0; fi
if [ "${1:-}" = - ] && [ "$#" = 3 ]; then exec "$BB_REAL_NODE" "$@"; fi
echo "node $*" >>"$TEST_LOG"
cat >/dev/null
exit "${NATIVE_EXIT:-0}"
EOF
  chmod +x "$NODE_DIR/bin/node"
  cat >"$BB_DIR/node_modules/.bin/bb-app" <<'EOF'
#!/usr/bin/env bash
echo "bb-app $*" >>"$TEST_LOG"
EOF
  chmod +x "$BB_DIR/node_modules/.bin/bb-app"
  write_stub bb-patch <<'EOF'
#!/usr/bin/env bash
echo "bb-patch $*" >>"$TEST_LOG"
[ "${PATCH_PREPARE_EXIT:-0}" = 0 ] || exit "$PATCH_PREPARE_EXIT"
package="$HOME/.local/share/bb-deploy/releases/${PATCH_ID:-example}/package"
mkdir -p "$package/dist"
cp "$BB_DIR/node_modules/bb-app/package.json" "$package/package.json"
: >"$package/dist/bb-app.js"
printf '{"package":"%s","version":"0.46.1","status":"%s","warning":"example missing patch"}\n' "$package" "${PATCH_STATUS:-patched}"
EOF
  write_stub launchctl <<'EOF'
#!/usr/bin/env bash
echo "launchctl $*" >>"$TEST_LOG"
case "$1" in
  bootout) [ "${BOOTOUT_EXIT:-0}" = 0 ] || exit "$BOOTOUT_EXIT"; touch "$HOME/service-stopped" ;;
  bootstrap) rm -f "$HOME/service-stopped" ;;
esac
EOF
  write_stub lsof <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
  write_stub curl <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >>"$TEST_LOG"
case "$*" in
  *'/threads/running')
    [ "${IDLE_EXIT:-0}" = 0 ] || exit "$IDLE_EXIT"
    echo "${RUNNING_JSON:-[]}"
    ;;
  *'/system/app-update') printf '{"current":{"version":"%s"}}\n' "${LIVE_VERSION:-0.46.1}" ;;
  *'/system/config') echo '{"primaryHostId":"host-local"}' ;;
  *'/hosts') echo '[{"id":"host-local","status":"connected"}]' ;;
  *'/health') [ ! -f "$HOME/service-stopped" ] || exit 7; echo '{"ok":true}' ;;
esac
EOF
  mkdir -p "$HOME/.bb"
  echo 'database fixture' >"$HOME/.bb/bb.db"
  write_stub sudo <<'EOF'
#!/usr/bin/env bash
echo "sudo $*" >>"$TEST_LOG"
[ "${SUDO_EXIT:-0}" = 0 ] || exit "$SUDO_EXIT"
[ "$1" = -n ] && shift
exec "$@"
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

@test "user preparation pins the checked package and service without restarting" {
  run zsh --no-rcs "$DEPLOY" prepare --user
  [ "$status" -eq 0 ]
  grep -q '^BB_DEPLOY_SERVICE = "user"' "$DEPLOY_ROOT/candidate/mise.toml"
  grep -q '^BB_DEPLOY_PACKAGE = "/' "$DEPLOY_ROOT/candidate/mise.toml"
  grep -q '^bb-patch prepare-package ' "$TEST_LOG"
  ! grep -q '^launchctl\|^sudo ' "$TEST_LOG"
}

@test "patch failure still prepares a stock user candidate" {
  export PATCH_STATUS=stock
  run zsh --no-rcs "$DEPLOY" prepare --user
  [ "$status" -eq 0 ]
  [[ "$output" == *'example missing patch'* ]]
  [ -f "$DEPLOY_ROOT/candidate/mise.toml" ]
}

@test "failed package preparation preserves the previous candidate" {
  prepare
  cp "$DEPLOY_ROOT/candidate/mise.toml" "$HOME/expected-candidate"
  export PATCH_PREPARE_EXIT=2
  run zsh --no-rcs "$DEPLOY" prepare --user
  [ "$status" -ne 0 ]
  cmp "$HOME/expected-candidate" "$DEPLOY_ROOT/candidate/mise.toml"
}

@test "user activation restarts the user service and keeps its mode on later prepares" {
  zsh --no-rcs "$DEPLOY" prepare --user
  zsh --no-rcs "$DEPLOY" adopt
  export PATCH_ID=updated
  run prepare
  [ "$status" -eq 0 ]
  grep -q '^BB_DEPLOY_SERVICE = "user"' "$DEPLOY_ROOT/candidate/mise.toml"
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 0 ]
  grep -q '^launchctl bootout gui/[0-9]*/org.nix-community.home.bb-server$' "$TEST_LOG"
  grep -q "^launchctl bootstrap gui/[0-9]* $HOME/Library/LaunchAgents/org.nix-community.home.bb-server.plist$" "$TEST_LOG"
  ! grep -q '^sudo ' "$TEST_LOG"
}

@test "user launcher runs only the package named by the deployed pins" {
  zsh --no-rcs "$DEPLOY" prepare --user
  zsh --no-rcs "$DEPLOY" adopt
  render_launcher
  : >"$TEST_LOG"
  run "$BASH5" "$HOME/launcher" server
  [ "$status" -eq 0 ]
  grep -q 'node .*/releases/example/package/dist/bb-app.js --server-bind-host 127.0.0.1 --no-in-app-updates' "$TEST_LOG"
  ! grep -q '^bb-app ' "$TEST_LOG"
}

@test "activation refuses a service migration before changing pins or restarting" {
  adopt
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  zsh --no-rcs "$DEPLOY" prepare --user
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -ne 0 ]
  [[ "$output" == *'service migration'* ]]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  ! grep -q '^launchctl\|^sudo ' "$TEST_LOG"
}

@test "user activation refuses older candidates against newer running data" {
  zsh --no-rcs "$DEPLOY" prepare --user
  zsh --no-rcs "$DEPLOY" adopt
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  export PATCH_ID=updated LIVE_VERSION=0.48.0
  prepare
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -ne 0 ]
  [[ "$output" == *'older or unverified candidate'* ]]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  ! grep -q '^launchctl\|^sudo ' "$TEST_LOG"
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

@test "prepare releases the lock when called as an autoloaded function" {
  run zsh --no-rcs -c 'fpath=("$1" $fpath); autoload -Uz bb-deploy; bb-deploy prepare' _ "$(dirname "$DEPLOY")"
  [ "$status" -eq 0 ]
  [ -f "$DEPLOY_ROOT/candidate/mise.toml" ]
  [ ! -e "$DEPLOY_ROOT/.lock" ]
}

@test "another deployment holds the lock" {
  mkdir -p "$DEPLOY_ROOT/.lock"
  run prepare
  [ "$status" -ne 0 ]
  [ -d "$DEPLOY_ROOT/.lock" ]
}

@test "busy tasks defer activation before stopping BB or privilege checks" {
  older_deployment
  export RUNNING_JSON='[{"id":"hidden-task","hostId":"host-local"}]'
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 75 ]
  ! grep -q '^sudo ' "$TEST_LOG"
  ! grep -q bootout "$TEST_LOG"
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

@test "BB that does not stop keeps deployed pins and restarts their release" {
  older_deployment
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  export BOOTOUT_EXIT=5
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -ne 0 ]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  grep -q 'launchctl bootstrap system /Library/LaunchDaemons/org.nixos.bb-server.plist' "$TEST_LOG"
  [ -z "$(ls -A "$HOME/.local/state/bb-deploy/snapshots")" ]
}

@test "failed snapshot keeps deployed pins and restarts their release" {
  older_deployment
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  chmod 000 "$HOME/.bb/bb.db"
  run zsh --no-rcs "$DEPLOY" activate
  chmod 600 "$HOME/.bb/bb.db"
  [ "$status" -ne 0 ]
  [[ "$output" == *'snapshot failed'* ]]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  [ "$(grep -c '^launchctl bootstrap ' "$TEST_LOG")" -eq 1 ]
}

@test "activation stops BB, snapshots its data, then starts the new pins" {
  older_deployment
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected-previous"
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 0 ]
  cmp "$HOME/expected-previous" "$DEPLOY_ROOT/previous/mise.toml"
  cmp "$DEPLOY_ROOT/candidate/mise.toml" "$DEPLOY_ROOT/current/mise.toml"
  snapshot=$(find "$HOME/.local/state/bb-deploy/snapshots" -mindepth 1 -maxdepth 1 -type d)
  cmp "$HOME/.bb/bb.db" "$snapshot/bb.db"
  [[ "$output" == *"snapshot $snapshot"* ]]
  stop_line=$(grep -n 'launchctl bootout system/org.nixos.bb-server$' "$TEST_LOG" | head -1 | cut -d: -f1)
  start_line=$(grep -n 'launchctl bootstrap system /Library/LaunchDaemons/org.nixos.bb-server.plist$' "$TEST_LOG" | tail -1 | cut -d: -f1)
  [ "$stop_line" -lt "$start_line" ]
}

@test "unchanged deployment never restarts BB" {
  adopt
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -eq 0 ]
  ! grep -q '^sudo ' "$TEST_LOG"
}

@test "missing sudo authentication leaves deployed pins unchanged" {
  older_deployment
  cp "$DEPLOY_ROOT/current/mise.toml" "$HOME/expected"
  export SUDO_EXIT=1
  run zsh --no-rcs "$DEPLOY" activate
  [ "$status" -ne 0 ]
  cmp "$HOME/expected" "$DEPLOY_ROOT/current/mise.toml"
  ! grep -q bootout "$TEST_LOG"
}

@test "unknown command fails before modifying deployment state" {
  run zsh --no-rcs "$DEPLOY" restart
  [ "$status" -eq 2 ]
  [ ! -d "$DEPLOY_ROOT" ]
}
