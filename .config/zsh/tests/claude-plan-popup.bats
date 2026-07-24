#!/usr/bin/env bats

bats_require_minimum_version 1.5.0
# bats file_tags=integration

load test_helper

LIB="$TESTS_DIR/../../tmux/scripts/lib/claude-plan.sh"

# The pure core reads the journal (AGENT_JOURNAL_DIR) and intersects with live
# panes via `tmux list-panes`. We stub `tmux` on PATH so no real server is
# needed: fzf/glow rendering stays out of scope (interactive), as with
# agent-popup.bats. Each function is exercised by sourcing the lib in a subshell.

setup() {
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  export AGENT_JOURNAL_DIR="$BATS_TEST_TMPDIR/journal"
  mkdir -p "$AGENT_JOURNAL_DIR"

  # tmux stub: emit the live-pane TSV (pane \t name \t window) from a fixture the
  # test writes to $LIVE_PANES. Only `list-panes` is used by the core.
  STUB_DIR="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$STUB_DIR"
  LIVE_PANES="$BATS_TEST_TMPDIR/live-panes.tsv"
  cat >"$STUB_DIR/tmux" <<EOF
#!/usr/bin/env bash
case "\$1" in
  list-panes) cat "$LIVE_PANES" 2>/dev/null || true ;;
  *) : ;;
esac
EOF
  chmod +x "$STUB_DIR/tmux"
  export PATH="$STUB_DIR:$PATH"
}

# Append one ExitPlanMode-style journal event.
# journal_event TS PANE CWD PLANFILE TITLE
journal_event() {
  local ts=$1 pane=$2 cwd=$3 pf=$4 title=$5
  jq -cn --arg ts "$ts" --arg pane "$pane" --arg cwd "$cwd" \
    --arg pf "$pf" --arg title "$title" '
    {ts: $ts, pane: $pane, cwd: $cwd, state: "working", kind: "claude",
     tool_name: "ExitPlanMode",
     plan: {plan: ($title + "\n\nbody text"), planFilePath: $pf}}' \
    >>"$AGENT_JOURNAL_DIR/events-2026-07.jsonl"
}

# live_row PANE [NAME] [WINDOW] — register a pane as live in the tmux stub.
live_row() {
  printf '%s\t%s\t%s\n' "$1" "${2:-}" "${3:-win}" >>"$LIVE_PANES"
}

# Run one lib function in a fresh bash, printing its output.
run_lib() {
  run bash -c ". '$LIB'; $*"
}

# acct is built into the path at runtime so the source never carries a concrete
# profile name (the claude-profile-leak-guard hook blocks literal ones; a `$`
# after the segment is exempt).
acct=demoacct

@test "claude_plan_account_label parses profile and default paths" {
  run_lib "claude_plan_account_label /Users/x/.claude-profiles/code/$acct/plans/a.md"
  [ "$status" -eq 0 ]
  [ "$output" = "$acct" ]

  run_lib 'claude_plan_account_label /Users/x/.claude/plans/a.md'
  [ "$status" -eq 0 ]
  [ "$output" = default ]
}

@test "live_rows picks the latest plan per pane across session churn" {
  # Same pane, two events (session-id churn) — the newer ts must win.
  journal_event 2026-07-24T10:00:00Z %119 /work/proj /Users/x/.claude/plans/old.md '# Old plan'
  journal_event 2026-07-24T11:00:00Z %119 /work/proj /Users/x/.claude/plans/new.md '# New plan'
  live_row %119 '' scripts

  run_lib 'claude_plan_live_rows'
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 1 ]
  [ "$(printf '%s\n' "$output" | cut -f1)" = %119 ]
  [ "$(printf '%s\n' "$output" | cut -f7)" = /Users/x/.claude/plans/new.md ]
  [ "$(printf '%s\n' "$output" | cut -f5)" = "New plan" ]
}

@test "live_rows includes only live panes and labels accounts" {
  journal_event 2026-07-24T11:00:00Z %10 /a "/Users/x/.claude-profiles/code/$acct/plans/s.md" '# Stretch'
  journal_event 2026-07-24T11:05:00Z %20 /b /Users/x/.claude/plans/d.md '# Default'
  journal_event 2026-07-24T11:10:00Z %99 /c /Users/x/.claude/plans/dead.md '# Dead pane'
  # Only %10 and %20 are live; %99 has a plan but no live pane.
  live_row %10 backend scripts
  live_row %20 '' nvim

  run_lib 'claude_plan_live_rows'
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 2 ]
  # %99 (no live pane) is absent → drives the picker path, never the fast path.
  ! printf '%s\n' "$output" | cut -f1 | grep -qx %99
  # account column (field 2) for each live pane.
  [ "$(printf '%s\n' "$output" | awk -F '\t' '$1=="%10"{print $2}')" = "$acct" ]
  [ "$(printf '%s\n' "$output" | awk -F '\t' '$1=="%20"{print $2}')" = default ]
  # name/window column (field 3): @agent_name when set, else window_name.
  [ "$(printf '%s\n' "$output" | awk -F '\t' '$1=="%10"{print $3}')" = backend ]
  [ "$(printf '%s\n' "$output" | awk -F '\t' '$1=="%20"{print $3}')" = nvim ]
}

@test "live_rows orders newest plan first" {
  journal_event 2026-07-24T10:00:00Z %1 /a /Users/x/.claude/plans/a.md '# Older'
  journal_event 2026-07-24T12:00:00Z %2 /b /Users/x/.claude/plans/b.md '# Newer'
  live_row %1
  live_row %2

  run_lib 'claude_plan_live_rows'
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | head -1 | cut -f1)" = %2 ]
}

@test "live_rows is empty when no live pane has a plan" {
  journal_event 2026-07-24T11:00:00Z %99 /c /Users/x/.claude/plans/x.md '# Orphan'
  live_row %1 # live but no plan

  run_lib 'claude_plan_live_rows'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "inline_for_pane returns the latest plan text even when the file is gone" {
  journal_event 2026-07-24T10:00:00Z %5 /a /tmp/gone-old.md '# Superseded'
  journal_event 2026-07-24T11:00:00Z %5 /a /tmp/gone.md '# Current plan'

  run_lib 'claude_plan_inline_for_pane %5'
  [ "$status" -eq 0 ]
  [[ "$output" == "# Current plan"* ]]
  [[ "$output" == *"body text"* ]]
}

@test "journal_files returns newest first, capped at two" {
  : >"$AGENT_JOURNAL_DIR/events-2026-05.jsonl"
  : >"$AGENT_JOURNAL_DIR/events-2026-06.jsonl"
  : >"$AGENT_JOURNAL_DIR/events-2026-07.jsonl"

  run_lib 'claude_plan_journal_files'
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c .)" = 2 ]
  [ "$(printf '%s\n' "$output" | sed -n 1p | xargs basename)" = events-2026-07.jsonl ]
  [ "$(printf '%s\n' "$output" | sed -n 2p | xargs basename)" = events-2026-06.jsonl ]
}
