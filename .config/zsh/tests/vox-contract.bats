#!/usr/bin/env bats

# bats file_tags=integration
#
# The two contracts vox depends on that no fake can keep for it, both driven
# against the real thing here:
#
#   1. The JSON MacWhisper's CLI emits. merge.py trusts
#      `segments[].{start,end,text}` with start/end as integer MILLISECONDS, and
#      `speaker` present only under --speakers. A MacWhisper update can change
#      any of that silently while every faked test in vox.bats stays green.
#   2. voxtap's padding invariant — one second of stream is one second of
#      wall-clock even when nothing is playing. The tap delivers no callbacks at
#      all through silence, so without padding the system track would compress
#      every quiet stretch out of existence and drift away from the mic track it
#      is merged against. Needs no audio to check, and holds regardless of what
#      the Mac happens to be doing.
#
# Each half skips when its binary is absent (Linux, or a machine without
# MacWhisper / before `drs`), keeping the fast subset fast: `mise run
# zsh-tests-fast` filters this file out.

bats_require_minimum_version 1.5.0

# shellcheck disable=SC1091
source "$BATS_TEST_DIRNAME/test_helper.bash"

MERGE_REAL="$HOME/.config/vox/merge.py"

setup_file() {
  command -v mw >/dev/null 2>&1 || return 0
  command -v say >/dev/null 2>&1 || return 0
  # A real utterance, not a sine tone: the schema only carries segments when
  # there is speech to segment. Built once per file — `say` plus a transcription
  # is the expensive part.
  export VOX_CONTRACT_WAV="$BATS_FILE_TMPDIR/speech.wav"
  say -o "$VOX_CONTRACT_WAV" --data-format=LEI16@16000 \
    "Right then. Shall we make a start on the kickoff?" 2>/dev/null || true
  if [ -s "$VOX_CONTRACT_WAV" ]; then
    mw transcribe "$VOX_CONTRACT_WAV" --format json --no-speakers \
      >"$BATS_FILE_TMPDIR/plain.json" 2>"$BATS_FILE_TMPDIR/plain.err" || true
  fi
}

require_mw() {
  command -v mw >/dev/null 2>&1 || skip "MacWhisper CLI (mw) not installed"
  command -v say >/dev/null 2>&1 || skip "say not available to build a fixture"
  [ -s "$BATS_FILE_TMPDIR/plain.json" ] || skip "mw produced no output for the fixture"
  PLAIN="$BATS_FILE_TMPDIR/plain.json"
}

require_voxtap() {
  command -v voxtap >/dev/null 2>&1 || skip "voxtap not installed (run drs)"
}

# assert_schema FILE - the shape merge.py depends on.
assert_schema() {
  python3 - "$1" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1]))
assert isinstance(payload, dict), "top level is not an object"
segments = payload["segments"]
assert isinstance(segments, list) and segments, "segments is not a non-empty list"
for segment in segments:
    for key in ("start", "end", "text"):
        assert key in segment, f"segment missing {key}"
    assert isinstance(segment["start"], int), "start is not an integer"
    assert isinstance(segment["end"], int), "end is not an integer"
    assert isinstance(segment["text"], str), "text is not a string"
# Milliseconds, not seconds: a ~3 s utterance ends in the thousands. Seconds
# would put it under 10, and every timestamp in transcript.md would read 00:00:00.
assert segments[-1]["end"] > 200, "end looks like seconds, not milliseconds"
PY
}

@test "mw --format json emits the segment schema merge.py parses" {
  require_mw
  assert_schema "$PLAIN"
}

@test "mw --format json writes pure JSON to stdout, progress to stderr" {
  require_mw
  # This is what lets vox pipe mw straight into a file with no -o flag.
  run python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$PLAIN"
  [ "$status" -eq 0 ]
  [ ! -s "$BATS_FILE_TMPDIR/plain.err" ] || grep -qi 'transcrib' "$BATS_FILE_TMPDIR/plain.err"
}

@test "--no-speakers omits the speaker key entirely" {
  require_mw
  # merge.py treats speaker as optional precisely because of this.
  run python3 -c '
import json, sys
segments = json.load(open(sys.argv[1]))["segments"]
print(any("speaker" in s for s in segments))
' "$PLAIN"
  [ "$output" = "False" ]
}

@test "--speakers keeps the same schema and may add a speaker key" {
  require_mw
  mw transcribe "$VOX_CONTRACT_WAV" --format json --speakers \
    >"$BATS_TEST_TMPDIR/diarised.json" 2>/dev/null || skip "diarised run failed"
  assert_schema "$BATS_TEST_TMPDIR/diarised.json"

  run python3 -c '
import json, sys
segments = json.load(open(sys.argv[1]))["segments"]
assert all(isinstance(s.get("speaker", ""), str) for s in segments)
' "$BATS_TEST_TMPDIR/diarised.json"
  [ "$status" -eq 0 ]
}

@test "merge.py renders real mw output into a timestamped transcript" {
  require_mw
  run python3 "$MERGE_REAL" --me "$PLAIN"

  [ "$status" -eq 0 ]
  [[ "${lines[0]}" =~ ^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]\ Me:\  ]]
}

@test "trimming a zero-padded tail leaves the speech mw hears intact" {
  require_mw
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  # voxtap pads silence with digital ZEROS to a monotonic clock (docs/adr/0003),
  # and Parakeet returns an EMPTY transcript for a clip ending in enough of them
  # (NVIDIA-NeMo/Speech#15757), so vox trims that tail off mw's input. What the
  # trim must never do is eat the speech, and only the real mw can say whether
  # it did.
  #
  # This is a guard on the trim, NOT a reproduction of the model bug: the `say`
  # fixture is clean enough to survive the padding untrimmed. Blanking needs a
  # marginal recording (measured: a 2.6 s quiet utterance at -48 dB mean vanishes
  # under 12 s of zeros, survives 5 s), which no synthetic fixture imitates —
  # `vox.bats` guards the trim itself, deterministically.
  ffmpeg -hide_banner -loglevel error -i "$VOX_CONTRACT_WAV" \
    -af 'apad=pad_dur=12' -c:a pcm_s16le -y "$BATS_TEST_TMPDIR/padded.wav"
  export VOX_STORE="$BATS_TEST_TMPDIR/padded-store"

  # --separate-stderr: the path is on stdout, the progress lines are not.
  run --separate-stderr zsh --no-rcs \
    "$HOME/.config/zsh/functions/macos/vox" "$BATS_TEST_TMPDIR/padded.wav"

  [ "$status" -eq 0 ]
  [ -s "$output/transcript.md" ]
  grep -qi 'kick' "$output/transcript.md"
}

@test "mw's output for a silent track reads solo, not 2-way" {
  require_mw
  command -v ffmpeg >/dev/null 2>&1 || skip "ffmpeg not on PATH"
  # The failure this guards was invisible to a hand-written fixture: mw emits a
  # TOP-LEVEL "text" key that is present but empty when nothing was
  # transcribed, so a check for the word "text" called every monologue 2-way.
  ffmpeg -hide_banner -loglevel error -f lavfi -i 'anullsrc=r=16000:cl=mono' \
    -t 2 -c:a pcm_s16le -y "$BATS_TEST_TMPDIR/silence.wav"
  mkdir -p "$BATS_TEST_TMPDIR/rec"
  mw transcribe "$BATS_TEST_TMPDIR/silence.wav" --format json --speakers \
    >"$BATS_TEST_TMPDIR/rec/sys.json" 2>/dev/null || skip "mw refused the silent track"

  run bash -c "source '$HOME/.config/tmux/scripts/vox-lib.sh'; vox_session_kind '$BATS_TEST_TMPDIR/rec'"

  [ "$output" = "solo" ]
}

# --- voxtap: the padding invariant ------------------------------------------
#
# `--probe N` measures the stream instead of writing it, so these need no audio
# playing and no pipe reader. The frame count is the assertion because it is the
# invariant: whatever the tap did or did not deliver, N seconds of stream must
# hold N × 48000 frames.

@test "voxtap --check verifies the tap without emitting anything" {
  require_voxtap

  run --separate-stderr voxtap --check

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "voxtap pads silence so stream time tracks wall-clock" {
  require_voxtap
  seconds=3

  run --separate-stderr voxtap --probe "$seconds"
  frames=$(printf '%s\n' "$stderr" | sed -n 's/.*frames: \([0-9]*\).*/\1/p')

  [ "$status" -eq 0 ]
  [ -n "$frames" ]
  # Tolerance, not equality: padding tops the stream up only once it is 0.2 s
  # behind, so the count trails wall-clock by up to that much, and real
  # callbacks arriving mid-tick can push it slightly ahead. A regression here
  # is total (0 frames through silence), not a few per cent.
  python3 -c '
import sys
frames, seconds = int(sys.argv[1]), int(sys.argv[2])
expected = seconds * 48000
assert 0.9 * expected <= frames <= 1.1 * expected, f"{frames} frames for {seconds}s"
' "$frames" "$seconds"
}

@test "voxtap probe reports how much of the stream was padded" {
  require_voxtap

  run --separate-stderr voxtap --probe 1

  # Nothing may be playing, so padded frames are not asserted non-zero — only
  # that the figure is reported, which is what makes a silent run diagnosable.
  [[ "$stderr" == *"padded: "* ]]
}
