#!/usr/bin/env bats

# The recording library. fzf is stubbed to answer with a key and a selection, so
# every action is driven exactly as a keypress would drive it - which is the only
# way to test code that otherwise needs a tty and a human.
#
# Not integration-tagged: no server, no audio, no real waits.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

POPUP="$HOME/.config/tmux/scripts/vox-popup.sh"
VOX_REAL="$HOME/.config/zsh/functions/macos/vox"
VOX_LIB_REAL="$HOME/.config/tmux/scripts/vox-lib.sh"

setup() {
  setup_test_home
  export VOX_STATEFILE="$HOME/.cache/tmux-vox.state"
  export VOX_JOBFILE="$HOME/.cache/tmux-vox.job"
  export VOX_SEENFILE="$HOME/.cache/tmux-vox.seen"
  export VOX_STORE="$HOME/Recordings/vox"
  export VOX_BIN="$TEST_BIN/vox"
  export VOX_LIB="$VOX_LIB_REAL"
  mkdir -p "$HOME/.cache" "$VOX_STORE"

  # A real `vox` on PATH: the picker's reclaim deliberately defers to it, so
  # stubbing it would test nothing.
  write_stub vox <<EOF
#!/usr/bin/env bash
exec zsh --no-rcs "$VOX_REAL" "\$@"
EOF
  write_stub tmux <<'EOF'
#!/usr/bin/env bash
printf 'tmux %s\n' "$*" >>"$TEST_LOG"
EOF
  write_stub open <<'EOF'
#!/usr/bin/env bash
printf 'open %s\n' "$*" >>"$TEST_LOG"
EOF
  write_stub afplay <<'EOF'
#!/usr/bin/env bash
printf 'afplay %s\n' "$*" >>"$TEST_LOG"
EOF
}

# recording NAME [KIND] - a finished recording; "2-way" also gives it a system
# track that transcribed to something.
recording() {
  local dir="$VOX_STORE/$1"
  mkdir -p "$dir"
  printf '[00:00:00] Me: hello\n' >"$dir/transcript.md"
  printf 'RIFFmic' >"$dir/mic.wav"
  printf '{"segments":[{"id":0,"start":0,"end":1,"text":"hello"}]}' >"$dir/mic.json"
  if [ "${2:-solo}" = 2-way ]; then
    printf 'RIFFsys' >"$dir/sys.wav"
    printf '{"segments":[{"id":0,"start":0,"end":1,"text":"yes hello"}]}' >"$dir/sys.json"
  else
    printf '{"segments":[]}' >"$dir/sys.json"
  fi
  printf '%s\n' "$dir"
}

# stub_fzf KEY [MATCH...] - answer with KEY and every input row whose name
# contains one of MATCH (all rows when none is given). The rows arrive on stdin
# exactly as the picker built them, so the fixture also captures the columns.
stub_fzf() {
  local key=$1
  shift
  export FZF_STUB_KEY="$key" FZF_STUB_MATCH="$*"
  write_stub fzf <<'EOF'
#!/usr/bin/env bash
rows=$(cat)
printf '%s\n' "$rows" >"$FZF_ROWS"
printf '%s\n' "$FZF_STUB_KEY"
if [ -z "$FZF_STUB_MATCH" ]; then
  printf '%s\n' "$rows"
else
  for want in $FZF_STUB_MATCH; do
    printf '%s\n' "$rows" | grep -- "$want"
  done
fi
EOF
  export FZF_ROWS="$BATS_TEST_TMPDIR/rows"
}

popup() {
  run env HOME="$HOME" PATH="$PATH" VOX_BIN="$VOX_BIN" VOX_STORE="$VOX_STORE" \
    VOX_STATEFILE="$VOX_STATEFILE" VOX_SEENFILE="$VOX_SEENFILE" \
    VOX_JOBFILE="$VOX_JOBFILE" TEST_LOG="$TEST_LOG" FZF_ROWS="$FZF_ROWS" \
    FZF_STUB_KEY="$FZF_STUB_KEY" FZF_STUB_MATCH="$FZF_STUB_MATCH" \
    "$POPUP" <<<"${1:-}"
}

@test "each row carries whether anyone else was on the call" {
  recording 2026-07-26-090000-standup solo >/dev/null
  recording 2026-07-28-140312-kickoff 2-way >/dev/null
  stub_fzf ""

  popup

  rows=$(cat "$FZF_ROWS")
  [[ "$rows" == *"2026-07-28-140312-kickoff"*"2-way"* ]] || false
  [[ "$rows" == *"2026-07-26-090000-standup"*"solo"* ]]
}

@test "a recording that transcribed to nothing reads empty, not solo" {
  dir=$(recording 2026-07-28-140312)
  : >"$dir/transcript.md"
  stub_fzf ""

  popup

  # `solo` would make it indistinguishable from a real monologue.
  [[ "$(cat "$FZF_ROWS")" == *"2026-07-28-140312"*"empty"* ]]
}

@test "the preview tells an empty transcript from an absent one" {
  present=$(recording 2026-07-28-140312)
  : >"$present/transcript.md"
  printf 'mw: nothing to do\n' >"$present/vox.log"
  absent=$(recording 2026-07-28-150000)
  rm -f "$absent/transcript.md"

  run "$POPUP" preview "$present"
  [[ "$output" == *"Transcribed to nothing"* ]]
  [[ "$output" == *"mw: nothing to do"* ]] # the log, which names why

  run "$POPUP" preview "$absent"
  # "No transcript yet" over a finished recording reads as still-pending forever.
  [[ "$output" == *"No transcript yet"* ]]
}

@test "enter on an empty transcript says so rather than copying nothing" {
  dir=$(recording 2026-07-28-140312)
  : >"$dir/transcript.md"
  stub_fzf ""

  popup

  grep -q 'transcribed to nothing' "$TEST_LOG"
  ! grep -q '^tmux load-buffer' "$TEST_LOG"
}

@test "opening the library marks everything as looked at" {
  recording 2026-07-28-140312 >/dev/null
  stub_fzf ""

  popup

  # This is what clears the READY pill, whether or not you pick anything.
  [ -f "$VOX_SEENFILE" ]
}

@test "ctrl-o reveals the recording in Finder" {
  dir=$(recording 2026-07-28-140312)
  stub_fzf ctrl-o

  popup

  grep -q "^open -R $dir$" "$TEST_LOG"
}

@test "ctrl-p plays the only track there is" {
  dir=$(recording 2026-07-28-140312 solo)
  stub_fzf ctrl-p

  popup

  grep -q "^afplay $dir/mic.wav$" "$TEST_LOG"
}

@test "ctrl-p mixes both halves of a conversation before playing" {
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  dir=$(recording 2026-07-28-140312 2-way)
  # Real audio: the mix is a real ffmpeg run, so placeholder bytes would only
  # exercise the fallback.
  ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=300' -t 1 \
    -ar 16000 -ac 1 -y "$dir/mic.wav"
  ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440' -t 1 \
    -ar 16000 -ac 1 -y "$dir/sys.wav"
  stub_fzf ctrl-p

  popup

  # Neither track alone: what plays is the conversation.
  grep -q '^afplay .*mix\.wav$' "$TEST_LOG"
}

@test "ctrl-d deletes the selection outright, once confirmed" {
  dir=$(recording 2026-07-28-140312)
  stub_fzf ctrl-d

  popup y

  [ ! -d "$dir" ]
}

@test "declining the delete keeps everything" {
  dir=$(recording 2026-07-28-140312)
  stub_fzf ctrl-d

  popup n

  [ -d "$dir" ]
}

@test "ctrl-d deletes every tab-selected recording" {
  one=$(recording 2026-07-28-140312-one)
  two=$(recording 2026-07-28-150000-two)
  three=$(recording 2026-07-28-160000-three)
  stub_fzf ctrl-d one two

  popup y

  [ ! -d "$one" ]
  [ ! -d "$two" ]
  [ -d "$three" ] # not selected
}

@test "ctrl-x reclaims audio through the CLI, keeping the transcript" {
  dir=$(recording 2026-07-28-140312)
  stub_fzf ctrl-x

  popup y

  # `vox prune <path>` owns which files are audio and what survives; the picker
  # only says which recordings.
  [ ! -e "$dir/mic.wav" ]
  [ -f "$dir/transcript.md" ]
  [ -f "$dir/mic.json" ]
}

@test "declining the reclaim keeps the audio" {
  dir=$(recording 2026-07-28-140312)
  stub_fzf ctrl-x

  popup n

  [ -s "$dir/mic.wav" ]
}
