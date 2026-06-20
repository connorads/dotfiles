#!/usr/bin/env bash

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZSH_DIR="$(cd "$TESTS_DIR/.." && pwd)"
# shellcheck disable=SC2034  # read by the .bats files that source this helper
FUNCTIONS_DIR="$ZSH_DIR/functions"

setup_test_home() {
	export TEST_HOME="$BATS_TEST_TMPDIR/home"
	export TEST_BIN="$BATS_TEST_TMPDIR/bin"
	export TEST_LOG="$BATS_TEST_TMPDIR/commands.log"

	mkdir -p "$TEST_HOME" "$TEST_BIN"
	export HOME="$TEST_HOME"
	# Preserve the path to zsh (may be nix-managed, not in /usr/bin)
	local zsh_dir
	zsh_dir="$(dirname "$(command -v zsh 2>/dev/null || echo /usr/bin/zsh)")"
	export PATH="$TEST_BIN:$zsh_dir:/usr/bin:/bin:/usr/sbin:/sbin"
	: >"$TEST_LOG"
}

write_executable() {
	local path=$1
	shift

	cat >"$path"
	chmod +x "$path"
}

write_stub() {
	local name=$1
	local path="$TEST_BIN/$name"
	shift

	write_executable "$path" "$@"
}

run_zsh_function() {
	local function_path=$1
	shift

	run zsh --no-rcs "$function_path" "$@"
}

assert_symlink_target() {
	local path=$1
	local expected=$2

	[ -L "$path" ]
	[ "$(readlink "$path")" = "$expected" ]
}

create_unix_socket() {
	local path=$1

	python3 - "$path" <<'PY'
import socket
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
sock = socket.socket(socket.AF_UNIX)
sock.bind(str(path))
sock.close()
PY
}

run_in_tty() {
	local command=$1

	if script --help 2>&1 | grep -q 'illegal option'; then
		run script -q /dev/null zsh --no-rcs -i -c "$command"
	else
		run script -qc "$command" /dev/null
	fi
}

# Indexed curl stub for the usage-tracker tests. Each invocation consumes the
# next response, keyed by 1-based call index N via env vars the test exports:
#   CURL_<N>_KIND = hb | stdout | net   (default net -> exit 7)
#   CURL_<N>_CODE = HTTP status for hb  (default 200)
#   CURL_<N>_BODY = file copied to curl's -o target for hb (default empty body)
#   CURL_<N>_OUT  = file streamed to stdout for the stdout kind
# The call counter lives in $CURL_STATE.
write_curl_stub() {
	export CURL_STATE="$BATS_TEST_TMPDIR/curl-state"
	: >"$CURL_STATE"
	write_stub curl <<'EOF'
#!/usr/bin/env bash
set -u
n=$(( $(cat "$CURL_STATE" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$CURL_STATE"
hdr="" out="" prev=""
for a in "$@"; do
  case "$prev" in
    -D) hdr="$a" ;;
    -o) out="$a" ;;
  esac
  prev="$a"
done
kv="CURL_${n}_KIND"; kind="${!kv:-net}"
case "$kind" in
  hb)
    cv="CURL_${n}_CODE"; code="${!cv:-200}"
    bv="CURL_${n}_BODY"; bf="${!bv:-}"
    [ -n "$hdr" ] && printf 'HTTP/1.1 %s OK\r\n\r\n' "$code" >"$hdr"
    if [ -n "$out" ]; then
      if [ -n "$bf" ]; then cat "$bf" >"$out"; else : >"$out"; fi
    fi
    ;;
  stdout)
    ov="CURL_${n}_OUT"; of="${!ov:-}"
    [ -n "$of" ] && cat "$of"
    ;;
  *) exit 7 ;;
esac
exit 0
EOF
}
