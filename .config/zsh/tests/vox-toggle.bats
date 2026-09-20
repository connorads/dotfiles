#!/usr/bin/env bats

# The prefix + Alt+v toggle: which of start/stop it picks, and the two orderings
# that make it usable — the title prompt appears while the capture is still
# starting and its dismissal decides the recording's fate, and stopping detaches
# instead of holding the key.
#
# A bare tmux server (`-f /dev/null`) so the real config's hooks cannot fire, and
# a `vox` stub so nothing here opens a microphone. Not integration-tagged: a bare
# server starts in ~1s.
#
# The prompt is a real one, on a real pty client: tmux exposes no format for
# "a prompt is open", so the client's typescript is polled for the prompt's
# text, and the answer is typed with `send-keys -K`. That keeps the whole
# path - the template, tmux's `%%%` substitution, the option round-trip - the
# production one rather than a re-implementation. Without a client attached
# `command-prompt` fails with "no current client", which is itself one of the
# paths under test.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

TOGGLE="$HOME/.config/tmux/scripts/vox-toggle.sh"
VOX_LIB_REAL="$HOME/.config/tmux/scripts/vox-lib.sh"
TMUX_BIN="$(command -v tmux)"

setup() {
  setup_test_home
  export VOX_STATEFILE="$HOME/.cache/tmux-vox.state"
  export VOX_JOBFILE="$HOME/.cache/tmux-vox.job"
  export VOX_SEENFILE="$HOME/.cache/tmux-vox.seen"
  export VOX_STORE="$HOME/Recordings/vox"
  export VOX_BIN="$TEST_BIN/vox"
  mkdir -p "$HOME/.cache" "$VOX_STORE"

  SOCK="voxtoggle_${BATS_TEST_NUMBER}_$$"
  "$TMUX_BIN" -L "$SOCK" -f /dev/null new-session -d -s s -x 80 -y 24
  PANE=$("$TMUX_BIN" -L "$SOCK" display-message -p '#{pane_id}')
  # The scripts call bare `tmux`, so route it at the private server - logging the
  # argv on the way through, because how the prompt is *asked* is behaviour too.
  write_stub tmux <<EOF
#!/usr/bin/env bash
printf 'tmux %s\n' "\$*" >>"\$TEST_LOG"
exec "$TMUX_BIN" -L "$SOCK" "\$@"
EOF
}

teardown() {
  [ -n "${ATTACH_PID:-}" ] && kill "$ATTACH_PID" 2>/dev/null || true
  stop_private_server
  if [ -f "$VOX_STATEFILE" ]; then
    kill "$(awk 'NR == 1 { print $1 }' "$VOX_STATEFILE" | tr ',' ' ')" 2>/dev/null || true
  fi
  true
}

# stub_vox - a `vox` that records what it was asked and pretends to succeed. The
# start branch also writes the statefile with a live pid, because the toggle's
# next decision is made from the lib's view of that file, not from vox's output.
# With VOX_TOGGLE_GATE set, the start finishes only once that file exists (or
# after 5 s, so a toggle that never raises the prompt fails rather than hangs).
stub_vox() {
  write_stub vox <<'EOF'
#!/usr/bin/env bash
printf 'vox %s\n' "$*" >>"$TEST_LOG"
case "${1:-}" in
"")
  if [ -n "${VOX_TOGGLE_GATE:-}" ]; then
    waited=0
    until [ -e "$VOX_TOGGLE_GATE" ] || [ "$waited" -ge 100 ]; do
      sleep 0.05
      waited=$((waited + 1))
    done
    [ -e "$VOX_TOGGLE_GATE" ] || { printf 'vox: start was never released\n' >&2; exit 1; }
  fi
  dir="$VOX_STORE/2026-07-28-140312"
  mkdir -p "$dir"
  sleep 30 >/dev/null 2>&1 &
  printf '%s %s %s\n' "$!" "$(date +%s)" "$dir" >"$VOX_STATEFILE"
  printf 'vox: recording\n' >&2
  printf '%s\n' "$dir"
  ;;
stop)
  rm -f "$VOX_STATEFILE"
  [ -n "${VOX_STUB_STOP_FAILS:-}" ] && exit 1
  printf '%s\n' "$VOX_STORE/2026-07-28-140312"
  ;;
cancel)
  kill "$(awk 'NR == 1 { print $1 }' "$VOX_STATEFILE")" 2>/dev/null
  rm -rf "$VOX_STATEFILE" "$VOX_STORE/2026-07-28-140312"
  ;;
rename)
  printf 'renamed %s -> %s\n' "$2" "$3" >>"$TEST_LOG"
  printf '%s-%s\n' "$2" "$3"
  ;;
esac
EOF
}

# A capture the lib will read as live.
live_capture() {
  sleep 30 >/dev/null 2>&1 &
  echo $! >>"$BATS_TEST_TMPDIR/spawned"
  printf '%s %s %s\n' "$!" "$(date +%s)" "$VOX_STORE/2026-07-28-140312-standup" \
    >"$VOX_STATEFILE"
}

toggle() {
  run env VOX_STATEFILE="$VOX_STATEFILE" VOX_JOBFILE="$VOX_JOBFILE" \
    VOX_SEENFILE="$VOX_SEENFILE" VOX_STORE="$VOX_STORE" VOX_BIN="$VOX_BIN" \
    TEST_LOG="$TEST_LOG" VOX_TOGGLE_GATE="${VOX_TOGGLE_GATE:-}" "$TOGGLE" "$@"
}

# toggle_answering PROMPT_TEXT ANSWER KEY -- ARGS - run the toggle against a
# real client, and once PROMPT_TEXT is on that client's screen type ANSWER (may
# be empty) into the prompt and press KEY (`Enter` or `Escape`). Sets $status
# and $output as `run` would. The toggle blocks on the prompt, so it runs in
# the background and is waited for, with a bound so a prompt that never took
# the answer fails the test rather than hanging the suite.
#
# The prompt text is the readiness signal because tmux exposes no format for
# an open prompt: keys sent before it is up would go to the pane instead, and
# the prompt would then wait forever. ANSWER and KEY are two send-keys calls
# because `-l` makes every argument literal, `Enter` included.
toggle_answering() {
  local text=$1 answer=$2 key=$3
  shift 4
  local typescript="$BATS_TEST_TMPDIR/client.typescript"
  attach_pty_client s "$typescript" || skip "could not attach a pty client"
  local client
  client=$("$TMUX_BIN" -L "$SOCK" list-clients -F '#{client_name}' | head -1)
  env VOX_STATEFILE="$VOX_STATEFILE" VOX_JOBFILE="$VOX_JOBFILE" \
    VOX_SEENFILE="$VOX_SEENFILE" VOX_STORE="$VOX_STORE" VOX_BIN="$VOX_BIN" \
    TEST_LOG="$TEST_LOG" VOX_TOGGLE_GATE="${VOX_TOGGLE_GATE:-}" \
    "$TOGGLE" "$@" >"$BATS_TEST_TMPDIR/toggle.out" 2>&1 &
  local toggle_pid=$!
  # shellcheck disable=SC2016  # a wait_until predicate expands per poll, not here
  wait_until -t 10 -d 'cat -v "$typescript"' 'grep -aqF "$text" "$typescript"'
  [ -n "${VOX_TOGGLE_GATE:-}" ] && : >"$VOX_TOGGLE_GATE"
  [ -n "$answer" ] && "$TMUX_BIN" -L "$SOCK" send-keys -K -c "$client" -l "$answer"
  "$TMUX_BIN" -L "$SOCK" send-keys -K -c "$client" "$key"
  # shellcheck disable=SC2016  # a wait_until predicate expands per poll, not here
  wait_until -t 15 -d 'cat "$TEST_LOG"' '! kill -0 "$toggle_pid" 2>/dev/null' ||
    kill "$toggle_pid" 2>/dev/null
  # `wait` returning the toggle's non-zero status must not trip errexit.
  wait "$toggle_pid" && status=0 || status=$?
  output=$(cat "$BATS_TEST_TMPDIR/toggle.out")
}

@test "idle starts a capture" {
  stub_vox

  toggle "$PANE"

  [ "$status" -eq 0 ]
  grep -q '^vox *$' "$TEST_LOG"
  [ -f "$VOX_STATEFILE" ]
}

@test "the title prompt is up before the capture has finished starting" {
  stub_vox
  # A gate, not a race: the stub's start cannot complete until the prompt is on
  # screen, so a toggle that asked only afterwards would time out here rather
  # than pass by scheduling luck. Starting costs a second or more, and the
  # prompt is what makes the key feel instant.
  export VOX_TOGGLE_GATE="$BATS_TEST_TMPDIR/prompt-raised"

  toggle_answering 'esc discards' '' Enter -- "$PANE"

  [ "$status" -eq 0 ]
  [ -f "$VOX_STATEFILE" ]
  grep -q 'display-message vox: recording 2026-07-28-140312' "$TEST_LOG"
}

@test "the title prompt asks one question and answers over an option" {
  stub_vox

  toggle "$PANE"

  # `command-prompt -p` splits its argument on commas into a *sequence* of
  # prompts, so this wording would otherwise be two questions - the second one
  # swallowing every keystroke while the pane looks frozen. `-l` says the text is
  # literal; a comma-free prompt would say the same thing.
  line=$(grep -m1 'command-prompt' "$TEST_LOG")
  [ -n "$line" ]
  prompt=${line#*-p }
  prompt=${prompt%%set-option*}
  [[ "$line" == *" -l "* ]] || [[ "$prompt" != *,* ]]
  # No -b: with it the CLI returns before the prompt is dismissed, and Esc could
  # not be told from a prompt still open.
  [[ "$line" != *" -b "* ]]
  # The answer lands in a tmux option, never on a shell command line: %%% is
  # spliced into the template and run-shell would hand it to sh -c, so a
  # backtick in a title would execute and a quote would lose the answer.
  [[ "$line" == *'set-option -g @vox_answer_'*'"x%%%"'* ]] || false
  [[ "$line" != *run-shell* ]]
}

@test "escaping the prompt discards the recording" {
  stub_vox

  toggle_answering 'esc discards' '' Escape -- "$PANE"

  [ "$status" -eq 0 ]
  grep -q '^vox cancel$' "$TEST_LOG"
  grep -q 'display-message vox: discarded 2026-07-28-140312' "$TEST_LOG"
  [ ! -f "$VOX_STATEFILE" ]
  ! grep -q 'renamed' "$TEST_LOG"
}

@test "enter with no title keeps the recording at its timestamp" {
  stub_vox

  toggle_answering 'esc discards' '' Enter -- "$PANE"

  [ "$status" -eq 0 ]
  ! grep -q '^vox cancel$' "$TEST_LOG"
  ! grep -q 'renamed' "$TEST_LOG"
  [ -f "$VOX_STATEFILE" ]
  grep -q 'display-message vox: recording 2026-07-28-140312$' "$TEST_LOG"
}

@test "a title renames the live recording" {
  stub_vox

  toggle_answering 'esc discards' 'Triver Kickoff' Enter -- "$PANE"

  [ "$status" -eq 0 ]
  grep -q "renamed $VOX_STORE/2026-07-28-140312 -> Triver Kickoff" "$TEST_LOG"
  grep -q 'display-message vox: recording 2026-07-28-140312-Triver Kickoff' "$TEST_LOG"
  ! grep -q '^vox cancel$' "$TEST_LOG"
}

@test "a title full of shell metacharacters reaches vox intact and runs nothing" {
  stub_vox
  # The old %% callback spliced the title into a run-shell command line, where
  # a backtick ran and a single quote lost the answer - which would now read as
  # Esc and discard the recording.
  title='Nat'"'"'s "call" `id` $HOME; x'

  toggle_answering 'esc discards' "$title" Enter -- "$PANE"

  [ "$status" -eq 0 ]
  grep -qF "renamed $VOX_STORE/2026-07-28-140312 -> $title" "$TEST_LOG"
  ! grep -q 'uid=' "$TEST_LOG"
  ! grep -q '^vox cancel$' "$TEST_LOG"
}

@test "with no client to ask, the recording is kept" {
  stub_vox
  # No client is attached, so command-prompt fails outright. That is not an
  # answer of Esc.

  toggle "$PANE"

  [ "$status" -eq 0 ]
  ! grep -q '^vox cancel$' "$TEST_LOG"
  [ -f "$VOX_STATEFILE" ]
  grep -q 'display-message vox: recording 2026-07-28-140312' "$TEST_LOG"
}

@test "prompt asks the pill menu's question too, on the client that asked" {
  stub_vox

  toggle prompt "$VOX_STORE/2026-07-28-140312-standup" client7

  [ "$status" -eq 0 ]
  line=$(grep -m1 'command-prompt' "$TEST_LOG")
  [ -n "$line" ]
  # One question, aimed at the client that clicked.
  [[ "$line" == *" -l "* ]] || false
  [[ "$line" == *"-t client7"* ]] || false
  [[ "$line" == *'set-option -g @vox_answer_'* ]] || false
}

@test "prompt renames the recording it was asked about" {
  stub_vox

  toggle_answering 'empty = none' 'Triver Kickoff' Enter -- \
    prompt "$VOX_STORE/2026-07-28-140312-standup"

  [ "$status" -eq 0 ]
  grep -q "renamed $VOX_STORE/2026-07-28-140312-standup -> Triver Kickoff" "$TEST_LOG"
}

@test "escaping the menu's prompt renames nothing and discards nothing" {
  stub_vox
  live_capture

  toggle_answering 'empty = none' '' Escape -- prompt "$VOX_STORE/2026-07-28-140312-standup"

  # The capture was not started by this prompt, so it is not this prompt's to
  # end: Esc here is "leave the name alone".
  [ "$status" -eq 0 ]
  ! grep -q 'renamed' "$TEST_LOG"
  ! grep -q '^vox cancel$' "$TEST_LOG"
  [ -f "$VOX_STATEFILE" ]
}

@test "recording stops, and does not hold the key while transcribing" {
  stub_vox
  live_capture

  toggle "$PANE"

  # The toggle returns at once; the stop runs detached behind it.
  [ "$status" -eq 0 ]
  wait_until -i 0.2 -d 'cat "$TEST_LOG"' 'grep -q "^vox stop$" "$TEST_LOG"'
}

@test "a finished transcription says so" {
  stub_vox

  toggle finish "$VOX_STORE/2026-07-28-140312-standup" "$PANE"

  [ "$status" -eq 0 ]
  grep -q '^vox stop$' "$TEST_LOG"
  grep -q 'display-message vox: transcript ready' "$TEST_LOG"
}

@test "a transcription that produced nothing is reported as such" {
  stub_vox
  # `vox stop` returns non-zero for a transcript with nothing in it as well as
  # for one that fell over, and announcing either as ready is the lie here.
  export VOX_STUB_STOP_FAILS=1
  run env VOX_STATEFILE="$VOX_STATEFILE" VOX_JOBFILE="$VOX_JOBFILE" \
    VOX_SEENFILE="$VOX_SEENFILE" VOX_STORE="$VOX_STORE" VOX_BIN="$VOX_BIN" \
    TEST_LOG="$TEST_LOG" VOX_STUB_STOP_FAILS=1 \
    "$TOGGLE" finish "$VOX_STORE/2026-07-28-140312" "$PANE"

  [ "$status" -eq 0 ]
  grep -q 'display-message vox: no speech transcribed' "$TEST_LOG"
  grep -q "$VOX_STORE/2026-07-28-140312/vox.log" "$TEST_LOG"
  ! grep -q 'transcript ready' "$TEST_LOG"
  # Nothing marks the seen file, so a later transcript can still read READY.
  [ ! -f "$VOX_SEENFILE" ]
}

@test "the bell rings whether or not there was anything to transcribe" {
  stub_vox
  # A recording that produced nothing needs your attention more than one that
  # worked, not less. ring_bell reaches the clients through tmux, so the lookup
  # is what says it ran.
  export VOX_STUB_STOP_FAILS=1
  run env VOX_STATEFILE="$VOX_STATEFILE" VOX_JOBFILE="$VOX_JOBFILE" \
    VOX_SEENFILE="$VOX_SEENFILE" VOX_STORE="$VOX_STORE" VOX_BIN="$VOX_BIN" \
    TEST_LOG="$TEST_LOG" VOX_STUB_STOP_FAILS=1 \
    "$TOGGLE" finish "$VOX_STORE/2026-07-28-140312" "$PANE"

  [ "$status" -eq 0 ]
  grep -q 'list-clients' "$TEST_LOG"
}

@test "pressing it while transcribing starts a new capture" {
  stub_vox
  sleep 30 >/dev/null 2>&1 &
  echo $! >>"$BATS_TEST_TMPDIR/spawned"
  printf '%s %s %s\n' "$!" "$(date +%s)" "$VOX_STORE/earlier" >"$VOX_JOBFILE"

  toggle "$PANE"

  # Transcription is per-directory and detached, so it never blocks the next
  # recording.
  grep -q '^vox *$' "$TEST_LOG"
  ! grep -q '^vox stop$' "$TEST_LOG"
}

@test "a refused start reports why, and escaping the prompt cancels nothing" {
  write_stub vox <<'EOF'
#!/usr/bin/env bash
printf 'vox %s\n' "$*" >>"$TEST_LOG"
printf 'vox: system audio capture is unavailable\n' >&2
exit 1
EOF
  # The prompt is already up when the start fails, so its answer is discarded
  # rather than acted on: there is nothing to rename and nothing to cancel.

  toggle_answering 'esc discards' '' Escape -- "$PANE"

  [ "$status" -ne 0 ]
  [ ! -f "$VOX_STATEFILE" ]
  ! grep -q '^vox cancel$' "$TEST_LOG"
  grep -q 'display-message vox: system audio capture is unavailable' "$TEST_LOG"
}
