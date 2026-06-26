#!/usr/bin/env bats
# shellcheck disable=SC2030,SC2031

SCRIPT="$HOME/.config/tmux/scripts/paste-clipboard-image.sh"

setup() {
	export TEST_BIN="$BATS_TEST_TMPDIR/bin"
	export TEST_LOG="$BATS_TEST_TMPDIR/commands.log"
	export CLIPIMG_TMPDIR="$BATS_TEST_TMPDIR/images"
	export CLIPIMG_TIMESTAMP="20260626-123456"
	mkdir -p "$TEST_BIN" "$CLIPIMG_TMPDIR"
	export PATH="$TEST_BIN:/usr/bin:/bin:/usr/sbin:/sbin"
	: >"$TEST_LOG"
}

write_stub() {
	local name="$1"
	cat >"$TEST_BIN/$name"
	chmod +x "$TEST_BIN/$name"
}

@test "parses ssh destination after common options" {
	run "$SCRIPT" --parse-ssh-host 'ssh -p 2222 -J jump -o StrictHostKeyChecking=no dev tmux attach'
	[ "$status" -eq 0 ]
	[ "$output" = "dev" ]
}

@test "parses mosh destination from preserved mosh-client argv" {
	run "$SCRIPT" --parse-mosh-host 'mosh-client -# --ssh=ssh -p 2222 connor@rpi5 tmux attach | 100.64.0.2 60042'
	[ "$status" -eq 0 ]
	[ "$output" = "connor@rpi5" ]
}

@test "detects foreground ssh host from ps output" {
	local ps_file="$BATS_TEST_TMPDIR/ps.txt"
	cat >"$ps_file" <<'EOF'
100 200 zsh -zsh
200 200 ssh ssh dev
EOF

	run "$SCRIPT" --detect-host-from-ps-file "$ps_file"
	[ "$status" -eq 0 ]
	[ "$output" = "dev" ]
}

@test "local pane pastes local clipboard image path" {
	write_stub pngpaste <<'EOF'
#!/usr/bin/env bash
printf 'PNG' >"$1"
EOF
	write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %q' "$1" >>"$TEST_LOG"
shift
for arg in "$@"; do printf ' %q' "$arg" >>"$TEST_LOG"; done
printf '\n' >>"$TEST_LOG"
case "$1" in
  display-message) exit 0 ;;
  set-buffer) exit 0 ;;
  paste-buffer) exit 0 ;;
esac
EOF
	local ps_file="$BATS_TEST_TMPDIR/ps.txt"
	cat >"$ps_file" <<'EOF'
100 100 zsh -zsh
EOF
	export CLIPIMG_PS_FILE="$ps_file"

	run "$SCRIPT"
	[ "$status" -eq 0 ]
	local expected="$CLIPIMG_TMPDIR/clip-20260626-123456.png"
	[ -s "$expected" ]
	grep -F "tmux set-buffer -- $expected" "$TEST_LOG"
	grep -F "tmux paste-buffer -p" "$TEST_LOG"
}

@test "ssh pane uploads clipboard image and pastes remote path" {
	write_stub pngpaste <<'EOF'
#!/usr/bin/env bash
printf 'PNG' >"$1"
EOF
	write_stub ssh <<'EOF'
#!/usr/bin/env bash
printf 'ssh %s\n' "$*" >>"$TEST_LOG"
EOF
	write_stub scp <<'EOF'
#!/usr/bin/env bash
printf 'scp %s\n' "$*" >>"$TEST_LOG"
EOF
	write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %q' "$1" >>"$TEST_LOG"
shift
for arg in "$@"; do printf ' %q' "$arg" >>"$TEST_LOG"; done
printf '\n' >>"$TEST_LOG"
EOF
	local ps_file="$BATS_TEST_TMPDIR/ps.txt"
	cat >"$ps_file" <<'EOF'
100 200 zsh -zsh
200 200 ssh ssh -p 2222 dev tmux attach
EOF
	export CLIPIMG_PS_FILE="$ps_file"

	run "$SCRIPT"
	[ "$status" -eq 0 ]
	grep -F "ssh dev mkdir -p '/tmp/screenshots'" "$TEST_LOG"
	grep -F "scp -q $CLIPIMG_TMPDIR/clip-20260626-123456.png dev:/tmp/screenshots/clip-20260626-123456.png" "$TEST_LOG"
	grep -F "tmux set-buffer -- /tmp/screenshots/clip-20260626-123456.png" "$TEST_LOG"
}

@test "mosh pane uploads using original mosh destination" {
	write_stub pngpaste <<'EOF'
#!/usr/bin/env bash
printf 'PNG' >"$1"
EOF
	write_stub ssh <<'EOF'
#!/usr/bin/env bash
printf 'ssh %s\n' "$*" >>"$TEST_LOG"
EOF
	write_stub scp <<'EOF'
#!/usr/bin/env bash
printf 'scp %s\n' "$*" >>"$TEST_LOG"
EOF
	write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %q' "$1" >>"$TEST_LOG"
shift
for arg in "$@"; do printf ' %q' "$arg" >>"$TEST_LOG"; done
printf '\n' >>"$TEST_LOG"
EOF
	local ps_file="$BATS_TEST_TMPDIR/ps.txt"
	cat >"$ps_file" <<'EOF'
100 200 zsh -zsh
200 200 mosh-client mosh-client -# --ssh=ssh -p 2222 connor@rpi5 tmux attach | 100.64.0.2 60042
EOF
	export CLIPIMG_PS_FILE="$ps_file"

	run "$SCRIPT"
	[ "$status" -eq 0 ]
	grep -F "ssh connor@rpi5 mkdir -p '/tmp/screenshots'" "$TEST_LOG"
	grep -F "scp -q $CLIPIMG_TMPDIR/clip-20260626-123456.png connor@rpi5:/tmp/screenshots/clip-20260626-123456.png" "$TEST_LOG"
	grep -F "tmux set-buffer -- /tmp/screenshots/clip-20260626-123456.png" "$TEST_LOG"
}

@test "no image shows message and does not paste" {
	write_stub pngpaste <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
	write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %q' "$1" >>"$TEST_LOG"
shift
for arg in "$@"; do printf ' %q' "$arg" >>"$TEST_LOG"; done
printf '\n' >>"$TEST_LOG"
EOF

	run "$SCRIPT"
	[ "$status" -eq 0 ]
	grep -F "tmux display-message No\\ image\\ on\\ clipboard" "$TEST_LOG"
	if grep -F "paste-buffer" "$TEST_LOG"; then
		false
	fi
}
