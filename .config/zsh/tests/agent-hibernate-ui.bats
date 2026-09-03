#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

ACTION="$HOME/.config/tmux/scripts/agent-hibernate-action.sh"
CONF="$HOME/.config/tmux/tmux.conf"
TOOLS="$HOME/.config/tmux/tools.tsv"

setup() {
  setup_test_home
  export ACTION_LOG="$BATS_TEST_TMPDIR/action.log"
  export ENGINE_LOG="$BATS_TEST_TMPDIR/engine.log"

  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %s\n' "$*" >>"$ACTION_LOG"
if [ "$1" = display-message ] && [[ " $* " == *" -p "* ]]; then
  printf 'agent-one\twindow-one\n'
fi
EOF

  write_executable "$BATS_TEST_TMPDIR/engine" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$ENGINE_LOG"
if [ "${ENGINE_RC:-0}" -ne 0 ]; then
  printf 'agent-hibernate: %s\n' "${ENGINE_ERROR:-refused}" >&2
  exit "$ENGINE_RC"
fi
case "$1" in
  hibernate) printf '%s\n' 'hibernated sid-1 in %5 - freed ~321 MB' ;;
  thaw) printf '%s\n' 'thawed sid-1 in %5' ;;
esac
EOF
  export AGENT_HIBERNATE_SH="$BATS_TEST_TMPDIR/engine"
}

@test "dedicated bindings use a collision-free lower and upper pair" {
  grep -F 'bind -N "Hibernate current Claude/Codex pane" M-z' "$CONF"
  grep -F 'bind -N "Thaw a hibernated agent session" M-Z' "$CONF"
  ! grep -Eq '^bind .* -n M-[zZ] ' "$CONF"
}

@test "duplicate Tools and agent-dot lifecycle rows are removed" {
  ! grep -q 'Claude: hibernate pane' "$TOOLS"
  ! grep -q 'Claude: thaw a hibernated session' "$TOOLS"
  ! sed -n '/Agent dot: set state/,/Right-click context menus/p' "$CONF" | grep -q 'hibernate (free RAM)'
  ! sed -n '/Agent dot: set state/,/Right-click context menus/p' "$CONF" | grep -q 'thaw (resume)'
}

@test "hibernate action reports success to the invoking client" {
  run "$ACTION" hibernate "%5" clientA

  [ "$status" -eq 0 ]
  [ "$(cat "$ENGINE_LOG")" = 'hibernate %5' ]
  grep -F 'tmux display-message -c clientA -d 4000 hibernate ✓ agent-one - freed ~321 MB; Enter or Alt+Shift+Z resumes' "$ACTION_LOG"
}

@test "thaw action reports success to the invoking client" {
  run "$ACTION" thaw "%5" clientA

  [ "$status" -eq 0 ]
  [ "$(cat "$ENGINE_LOG")" = 'thaw %5' ]
  grep -F 'tmux display-message -c clientA -d 4000 thaw ✓ agent-one' "$ACTION_LOG"
}

@test "action turns an engine refusal into durable status feedback" {
  export ENGINE_RC=6 ENGINE_ERROR='refusing: pane %5 is working'

  run "$ACTION" hibernate "%5" clientA

  [ "$status" -eq 0 ]
  grep -F 'tmux display-message -c clientA -d 6000 hibernate ✗ refusing: pane %5 is working' "$ACTION_LOG"
}
