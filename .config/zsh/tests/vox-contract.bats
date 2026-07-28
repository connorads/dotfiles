#!/usr/bin/env bats

# bats file_tags=integration
#
# Contract test for the one thing in vox that is not ours: the JSON MacWhisper's
# CLI emits. merge.py trusts `segments[].{start,end,text}` with start/end as
# integer MILLISECONDS, and `speaker` present only under --speakers. A
# MacWhisper update can change any of that silently, and every faked test in
# vox.bats would stay green — so this drives the real binary and asserts the
# shape merge.py parses.
#
# Skips when `mw` is absent (Linux, or a machine without MacWhisper), keeping
# the fast subset fast: `mise run zsh-tests-fast` filters this file out.

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

setup() {
  command -v mw >/dev/null 2>&1 || skip "MacWhisper CLI (mw) not installed"
  command -v say >/dev/null 2>&1 || skip "say not available to build a fixture"
  [ -s "$BATS_FILE_TMPDIR/plain.json" ] || skip "mw produced no output for the fixture"
  PLAIN="$BATS_FILE_TMPDIR/plain.json"
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
  assert_schema "$PLAIN"
}

@test "mw --format json writes pure JSON to stdout, progress to stderr" {
  # This is what lets vox pipe mw straight into a file with no -o flag.
  run python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$PLAIN"
  [ "$status" -eq 0 ]
  [ ! -s "$BATS_FILE_TMPDIR/plain.err" ] || grep -qi 'transcrib' "$BATS_FILE_TMPDIR/plain.err"
}

@test "--no-speakers omits the speaker key entirely" {
  # merge.py treats speaker as optional precisely because of this.
  run python3 -c '
import json, sys
segments = json.load(open(sys.argv[1]))["segments"]
print(any("speaker" in s for s in segments))
' "$PLAIN"
  [ "$output" = "False" ]
}

@test "--speakers keeps the same schema and may add a speaker key" {
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
  run python3 "$MERGE_REAL" --me "$PLAIN"

  [ "$status" -eq 0 ]
  [[ "${lines[0]}" =~ ^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]\ Me:\  ]]
}
