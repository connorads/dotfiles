#!/usr/bin/env bats

setup() {
	SCRIPT="$BATS_TEST_DIRNAME/../scripts/check-scaffolders.sh"
	BIN="$BATS_TEST_TMPDIR/bin"
	LOG="$BATS_TEST_TMPDIR/commands.log"
	mkdir -p "$BIN"
	for name in pnpm uv cargo; do
		cat >"$BIN/$name" <<'EOF'
#!/bin/sh
printf '%s %s\n' "${0##*/}" "$*" >> "$COMMAND_LOG"
if [ "${0##*/}" = pnpm ] && [ "${1:-}" = init ]; then
	printf '{}\n' > package.json
fi
for arg in "$@"; do
	case "$arg" in
		/*) mkdir -p "$arg/src"; printf '{}\n' > "$arg/package.json"; : > "$arg/pyproject.toml"; : > "$arg/Cargo.toml" ;;
	esac
done
case "$*" in
	*'create vite@latest'*) mkdir -p "$3/src"; printf '{}\n' > "$3/package.json" ;;
	*'create-foldkit-app'*)
		while [ "$#" -gt 0 ]; do
			if [ "$1" = --name ]; then mkdir -p "$2/src"; printf '{}\n' > "$2/package.json"; break; fi
			shift
		done
		;;
esac
exit 0
EOF
		chmod +x "$BIN/$name"
	done
	export PATH="$BIN:/usr/bin:/bin"
	export COMMAND_LOG="$LOG"
}

@test "help performs no external command" {
	run "$SCRIPT" --help
	[ "$status" -eq 0 ]
	[ ! -e "$LOG" ]
}

@test "one recipe uses its official scaffolder without deployment" {
	run "$SCRIPT" --recipe vite-react-ts --output "$BATS_TEST_TMPDIR/output"
	[ "$status" -eq 0 ]
	grep -q '^pnpm create vite@latest ' "$LOG"
	! grep -Eqi 'deploy|alchemy dev|gh repo' "$LOG"
	[[ "$output" == *"PASS vite-react-ts"* ]]
}

@test "all recipes remain bounded and deployment-free" {
	run "$SCRIPT" --output "$BATS_TEST_TMPDIR/matrix"
	[ "$status" -eq 0 ]
	[ "$(grep -c '^' "$LOG")" -eq 10 ]
	! grep -Eqi 'deploy|alchemy dev|gh repo' "$LOG"
	[ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -le 15 ]
}

@test "invalid recipe exits 2 before network use" {
	run "$SCRIPT" --recipe nope
	[ "$status" -eq 2 ]
	[ ! -e "$LOG" ]
}
