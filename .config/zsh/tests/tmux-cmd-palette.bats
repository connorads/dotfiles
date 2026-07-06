#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load test_helper

setup() {
  setup_test_home
  SCRIPT="$TESTS_DIR/../../tmux/scripts/cmd-palette.sh"
  export FZF_STDIN="$BATS_TEST_TMPDIR/fzf-stdin"
  write_stub glow <<'EOF'
#!/usr/bin/env sh
while [ "$#" -gt 0 ]; do
  [ "$1" = "-" ] && exec cat
  shift
done
exec cat
EOF
}

write_fzf_selecting_lazygit() {
  write_stub fzf <<'EOF'
#!/usr/bin/env sh
tmp="${FZF_STDIN}.tmp"
cat >"$tmp"
cat "$tmp" >"$FZF_STDIN"
awk '/Lazygit/ { print; exit }' "$tmp"
EOF
}

write_tmux_palette_stub() {
  write_stub tmux <<'EOF'
#!/usr/bin/env sh
{
  printf 'tmux'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >>"$TEST_LOG"

if [ "${1:-}" = "list-keys" ] && [ "${2:-}" = "-NT" ]; then
  printf 'C-b /      Command palette\n'
  printf 'C-b g      Lazygit · git commit branch\n'
  exit 0
fi

if [ "${1:-}" = "list-keys" ] && [ "${2:-}" = "-N" ] && [ "${3:-}" = "-P" ] && [ "${4+x}" = x ] && [ "$4" = "" ] && [ "${5:-}" = "-T" ]; then
  printf '/      Command palette\n'
  printf 'g      Lazygit · git commit branch\n'
  exit 0
fi

if [ "${1:-}" = "list-keys" ] && [ "${2:-}" = "-T" ] && [ "${3:-}" = "prefix" ]; then
  printf 'bind-key    -T prefix /       run-shell "sh ~/.config/tmux/scripts/cmd-palette.sh"\n'
  printf 'bind-key    -T prefix g       run-shell -b "sh /Users/connorads/.config/tmux/scripts/track-bind.sh g lazygit #{q:session_name} #{window_index} #{pane_index} #{q:pane_current_path} #{q:host_short}" \\; display-popup -E -d "#{pane_current_path}" -h "98%%" -w "98%%" "zsh -ic \\"lazygit\\""\n'
  exit 0
fi

exit 0
EOF
}

@test "enter replays the selected binding key, not the displayed prefix" {
  write_fzf_selecting_lazygit
  write_tmux_palette_stub

  run sh "$SCRIPT"

  [ "$status" -eq 0 ]
  grep -Fxq 'tmux <switch-client> <-T> <prefix>' "$TEST_LOG"
  grep -Fxq 'tmux <send-keys> <-K> <g>' "$TEST_LOG"
  if grep -Fxq 'tmux <send-keys> <-K> <C-b>' "$TEST_LOG"; then
    echo "replayed the displayed prefix instead of the selected key" >&2
    false
  fi
}

@test "preview shows the selected binding note without the displayed prefix" {
  write_tmux_palette_stub

  run sh "$SCRIPT" --preview g

  [ "$status" -eq 0 ]
  [[ "$output" == *"> Lazygit · git commit branch"* ]]
  [[ "$output" != *"> g      Lazygit"* ]]
  [[ "$output" != *"> C-b g"* ]]
}
