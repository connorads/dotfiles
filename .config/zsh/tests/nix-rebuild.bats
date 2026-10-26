#!/usr/bin/env bats

# Rebuild commands are stubbed. Only the disconnect test requires macOS launchd.
#
# Regression: drs/hms took no "$@", so `drsr` (then `drs --rollback`) discarded
# the flag and performed a plain switch, exiting 0. A rollback that silently
# switches is worst exactly when it is reached, after a bad switch.

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

setup() {
  setup_test_home

  # sudo: transparent, so the wrapper's real argv reaches the stub below.
  write_stub sudo <<'EOF'
#!/usr/bin/env bash
if [ "$1" = -v ]; then exit "${SUDO_FAIL:-0}"; fi
if [ "$1" = -n ]; then shift; fi
if [ "$1" = chown ]; then exit 0; fi
exec "$@"
EOF

  write_stub plutil <<'EOF'
#!/usr/bin/env python3
import json
import plistlib
import sys
from pathlib import Path

args = sys.argv[1:]
path = Path(args[-1])
if args[0] == '-create':
    data = {}
else:
    data = plistlib.loads(path.read_bytes())
    key, kind, value = args[1:4]
    if kind == '-json':
        value = json.loads(value)
    elif kind == '-bool':
        value = value == 'YES'
    if '.' in key:
        parent, index = key.split('.')
        data[parent].insert(int(index), value)
    else:
        data[key] = value
path.write_bytes(plistlib.dumps(data))
EOF

  write_stub launchctl <<'EOF'
#!/usr/bin/env python3
import os
import plistlib
import sys
from pathlib import Path

if sys.argv[1] == 'bootstrap':
    assert sys.argv[2] == 'system'
    data = plistlib.loads(Path(sys.argv[3]).read_bytes())
    assert data['UserName'] == 'root'
    os.execv(data['ProgramArguments'][0], data['ProgramArguments'])
assert sys.argv[1] == 'bootout'
EOF

  for cmd in darwin-rebuild home-manager nixos-rebuild; do
    write_stub "$cmd" <<EOF
#!/usr/bin/env bash
echo "$cmd \$*" >>"\$TEST_LOG"
EOF
  done
}

# assert_invocation <wrapper> <expected argv line>
assert_invocation() {
  local wrapper=$1 expected=$2
  shift 2

  run_zsh_function "$FUNCTIONS_DIR/nix/$wrapper" "$@"
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG")" = "$expected" ]
}

@test "drs switches against the flake" {
  assert_invocation drs "darwin-rebuild switch --flake $TEST_HOME/.config/nix"
}

@test "drs forwards extra arguments" {
  assert_invocation drs \
    "darwin-rebuild switch --flake $TEST_HOME/.config/nix --show-trace" --show-trace
}

@test "drsr passes --rollback to darwin-rebuild" {
  assert_invocation drsr \
    "darwin-rebuild switch --flake $TEST_HOME/.config/nix --rollback"
}

@test "hms switches against the flake" {
  assert_invocation hms "home-manager switch --flake $TEST_HOME/.config/nix"
}

@test "hms forwards extra arguments" {
  assert_invocation hms \
    "home-manager switch --flake $TEST_HOME/.config/nix --show-trace" --show-trace
}

@test "hmsr passes --rollback to home-manager" {
  # --rollback must trail `switch`: home-manager rejects it at top level.
  assert_invocation hmsr \
    "home-manager switch --flake $TEST_HOME/.config/nix --rollback"
}

@test "nrs switches against the flake" {
  assert_invocation nrs "nixos-rebuild switch --flake $TEST_HOME/.config/nix"
}

@test "nrsr passes --rollback to nixos-rebuild" {
  assert_invocation nrsr \
    "nixos-rebuild switch --flake $TEST_HOME/.config/nix --rollback"
}

@test "nrs honours NIXOS_FLAKE" {
  NIXOS_FLAKE=/etc/nixos assert_invocation nrs \
    "nixos-rebuild switch --flake /etc/nixos"
}

@test "drs retains output and the failing rebuild exit status" {
  write_stub darwin-rebuild <<'EOF'
#!/usr/bin/env bash
printf 'build output\n'
printf 'activation failed\n' >&2
exit 23
EOF
  run_zsh_function "$FUNCTIONS_DIR/nix/drs"
  [ "$status" -eq 23 ]
  [[ "$output" == *"build output"* ]]
  [[ "$output" == *"activation failed"* ]]
  [[ "$output" == *"Rebuild log:"* ]]
}

@test "drs does not submit a rebuild when authentication fails" {
  export SUDO_FAIL=1
  run_zsh_function "$FUNCTIONS_DIR/nix/drs"
  [ "$status" -ne 0 ]
  [ ! -s "$TEST_LOG" ]
}

@test "drs rebuild survives loss of the calling process group" {
  [ -x /bin/launchctl ] || skip "requires macOS launchd"
  write_stub launchctl <<'STUB'
#!/usr/bin/env python3
import os
import plistlib
import sys
from pathlib import Path

# Exercise real launchd without requiring root in the test runner.
if sys.argv[1] == 'bootstrap':
    path = Path(sys.argv[3])
    data = plistlib.loads(path.read_bytes())
    assert sys.argv[2] == 'system'
    assert data.pop('UserName') == 'root'
    path.write_bytes(plistlib.dumps(data))
    os.execv('/bin/launchctl', ['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)])
os.execv('/bin/launchctl', ['launchctl', 'bootout', sys.argv[2].replace('system/', f'gui/{os.getuid()}/')])
STUB
  write_stub darwin-rebuild <<'STUB'
#!/bin/sh
root=${0%/*}
touch "$root/started"
while [ ! -f "$root/release" ]; do sleep 0.05; done
printf 'activation completed\n'
STUB

  # Real launchd runs a harmless rebuild in the test user domain.
  run python3 - "$FUNCTIONS_DIR/nix/drs" <<'PY'
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(os.environ['TEST_BIN'])
with (root / 'client.log').open('w') as output:
    client = subprocess.Popen(['zsh', '-f', sys.argv[1]], stdout=output,
                              stderr=output, start_new_session=True)
    try:
        deadline = time.monotonic() + 10
        while not (root / 'started').exists():
            if client.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError((root / 'client.log').read_text())
            time.sleep(0.05)
        os.killpg(client.pid, signal.SIGTERM)
        client.wait(timeout=5)
    finally:
        (root / 'release').touch()
        if client.poll() is None:
            os.killpg(client.pid, signal.SIGTERM)
            client.wait(timeout=5)
PY
  local client_status=$status
  local run_dir
  run_dir=$(find "$TEST_HOME/.local/state/drs" -type d -name 'run.*' | head -1)
  export DRS_RESULT="$run_dir/result"
  wait_until -t 10 '[ -s "$DRS_RESULT" ]'
  /bin/launchctl bootout "gui/$(id -u)/org.nixos.drs.${run_dir##*/}"
  [ "$client_status" -eq 0 ]
  [ "$(cat "$DRS_RESULT")" = 0 ]
  grep -q 'activation completed' "$run_dir/output.log"
}

@test "drs preserves argument boundaries and the working directory" {
  write_stub darwin-rebuild <<'STUB'
#!/bin/sh
printf '%s\n' "$PWD" "$@"
STUB
  run_zsh_function "$FUNCTIONS_DIR/nix/drs" --argstr example 'two words'
  [ "$status" -eq 0 ]
  [[ "$output" == *"$PWD"* ]]
  [[ "$output" == *$'--argstr\nexample\ntwo words'* ]]
}
