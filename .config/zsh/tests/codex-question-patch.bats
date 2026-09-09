#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

source "$BATS_TEST_DIRNAME/test_helper.bash"

MANAGER="$REAL_HOME/.local/libexec/codex-question-patch.py"

setup() {
  setup_test_home
  mkdir -p "$HOME/.config/codex-question-patch/manifests"
  write_stub codesign <<'SH'
#!/bin/sh
case "$1" in
-d*)
  echo 'Identifier=codex' >&2
  echo 'Authority=Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)' >&2
  echo 'TeamIdentifier=2DC432GLL2' >&2
  ;;
esac
exit 0
SH
  make_fixture
  stub_mise "$FIXTURE"
}

# The manager asks mise where Codex is installed, and derives the version from
# that path - so the fixture's <version>/bin/codex layout is the whole contract.
stub_mise() {
  local target=$1
  write_stub mise <<SH
#!/bin/sh
[ "\$1" = which ] && [ "\$2" = codex ] || exit 1
printf '%s\n' '$target'
SH
}

make_fixture() {
  FIXTURE="$BATS_TEST_TMPDIR/0.0.1/bin/codex"
  mkdir -p "${FIXTURE%/*}"
  printf '#!/bin/sh\nprintf "codex-cli 0.0.1\\n"\n# ABCD\n' >"$FIXTURE"
  chmod +x "$FIXTURE"
  python3 - "$FIXTURE" "$HOME/.config/codex-question-patch/manifests/0.0.1.json" <<'PY'
import hashlib
import json
import platform
import sys
from pathlib import Path

binary = Path(sys.argv[1])
manifest = Path(sys.argv[2])
data = binary.read_bytes()
offset = data.index(b"ABCD")
patched = data[:offset] + b"WXYZ" + data[offset + 4:]
start = max(0, offset - 8)
end = min(len(data), offset + 12)
manifest.write_text(json.dumps({
    "format_version": 1,
    "codex_version": "0.0.1",
    "source_commit": "fixture",
    "os": platform.system().lower(),
    "arch": platform.machine().lower(),
    "upstream": {
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "identifier": "codex",
        "team_identifier": "2DC432GLL2"
    },
    "intervention": {
        "kind": "four-byte-patch",
        "offset": offset,
        "before_hex": "41424344",
        "after_hex": "5758595a",
        "window_start": start,
        "window_size": end - start,
        "window_sha256": hashlib.sha256(data[start:end]).hexdigest(),
        "raw_patched_sha256": hashlib.sha256(patched).hexdigest(),
        "description": "fixture"
    }
}))
PY
}

@test "stage admits only the exact reviewed binary" {
  run "$MANAGER" stage "$FIXTURE" 0.0.1

  [ "$status" -eq 0 ]
  [[ "$output" == *"PENDING 0.0.1"* ]]
  [ ! -e "$HOME/.local/share/codex-question-patch/active.json" ]

  printf x >>"$FIXTURE"
  run "$MANAGER" stage "$FIXTURE" 0.0.1

  [ "$status" -ne 0 ]
  [[ "$output" == *"upstream size mismatch"* ]]
}

@test "stage refuses a changed instruction window without writing a candidate" {
  python3 - "$FIXTURE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
d = bytearray(p.read_bytes())
d[d.index(b"ABCD") - 1] ^= 1
p.write_bytes(d)
PY

  run "$MANAGER" stage "$FIXTURE" 0.0.1

  [ "$status" -ne 0 ]
  [[ "$output" == *"upstream sha256 mismatch"* ]]
  [ ! -e "$HOME/.local/share/codex-question-patch/pending/0.0.1/receipt.json" ]
}

@test "activation is refused until the pending candidate validates" {
  "$MANAGER" stage "$FIXTURE" 0.0.1

  run "$MANAGER" activate 0.0.1
  [ "$status" -ne 0 ]
  [[ "$output" == *"has not passed validation"* ]]

  run "$MANAGER" validate 0.0.1
  [ "$status" -eq 0 ]
  [[ "$output" == *"VALIDATED 0.0.1"* ]]

  run "$MANAGER" activate 0.0.1
  [ "$status" -eq 0 ]
  [[ "$output" == *"ACTIVE 0.0.1"* ]]
}

@test "exec fails closed when the active artefact changes" {
  "$MANAGER" stage "$FIXTURE" 0.0.1
  "$MANAGER" validate 0.0.1
  "$MANAGER" activate 0.0.1

  run "$MANAGER" exec -- --version
  [ "$status" -eq 0 ]
  [ "$output" = "codex-cli 0.0.1" ]

  printf x >>"$HOME/.local/share/codex-question-patch/versions/0.0.1/codex"
  run "$MANAGER" exec -- --version

  [ "$status" -ne 0 ]
  [[ "$output" == *"active artefact sha256 mismatch"* ]]
}

@test "exec does not bootstrap over a damaged active artefact" {
  local root="$HOME/.local/share/codex-question-patch"
  "$MANAGER" stage "$FIXTURE" 0.0.1
  "$MANAGER" validate 0.0.1
  "$MANAGER" activate 0.0.1
  printf x >>"$root/versions/0.0.1/codex"

  run "$MANAGER" exec -- --version

  [ "$status" -ne 0 ]
  [[ "$output" == *"codex-question-patch repair"* ]]
  # Untouched: a recorded decision with a mismatched artefact is repair's to
  # answer, so nothing may be re-staged or silently re-signed over it.
  [ "$(tail -c 1 "$root/versions/0.0.1/codex")" = "x" ]
  [ "$(find "$root/pending" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" -eq 1 ]
}

@test "exec bootstraps and activates a virgin state" {
  run "$MANAGER" exec -- --version

  [ "$status" -eq 0 ]
  [[ "$output" == *"codex-cli 0.0.1"* ]]
  grep -q '"version": "0.0.1"' "$HOME/.local/share/codex-question-patch/active.json"
}

@test "exec bootstraps but does not activate over prior state" {
  local root="$HOME/.local/share/codex-question-patch"
  "$MANAGER" stage "$FIXTURE" 0.0.1
  "$MANAGER" validate 0.0.1
  "$MANAGER" activate 0.0.1
  mv "$root/active.json" "$root/previous.json"

  run "$MANAGER" exec -- --version

  [ "$status" -ne 0 ]
  [[ "$output" == *"codex-question-patch activate 0.0.1"* ]]
  [ ! -e "$root/active.json" ]
}

@test "exec bootstrap refuses an unreviewed version" {
  local other="$BATS_TEST_TMPDIR/0.0.2/bin/codex"
  mkdir -p "${other%/*}"
  cp "$FIXTURE" "$other"
  stub_mise "$other"

  run "$MANAGER" exec -- --version

  [ "$status" -eq 3 ]
  [[ "$output" == *"REVIEW REQUIRED 0.0.2"* ]]
  [[ "$output" == *"brief 0.0.2"* ]]
  [ ! -e "$HOME/.local/share/codex-question-patch/active.json" ]
}

@test "bootstrap is idempotent" {
  run "$MANAGER" bootstrap
  [ "$status" -eq 0 ]
  [[ "$output" == *"ACTIVE 0.0.1 (first activation)"* ]]

  run "$MANAGER" bootstrap
  [ "$status" -eq 0 ]
  [ "$output" = "ACTIVE 0.0.1" ]
}

@test "unknown versions remain pending review and never replace active" {
  "$MANAGER" stage "$FIXTURE" 0.0.1
  "$MANAGER" validate 0.0.1
  "$MANAGER" activate 0.0.1

  run "$MANAGER" stage "$FIXTURE" 0.0.2

  [ "$status" -eq 3 ]
  [[ "$output" == *"REVIEW REQUIRED 0.0.2"* ]]
  grep -q '"version": "0.0.1"' "$HOME/.local/share/codex-question-patch/active.json"
}

@test "repair refuses a damaged active artefact when no verified previous exists" {
  "$MANAGER" stage "$FIXTURE" 0.0.1
  "$MANAGER" validate 0.0.1
  "$MANAGER" activate 0.0.1
  printf x >>"$HOME/.local/share/codex-question-patch/versions/0.0.1/codex"

  run "$MANAGER" repair

  [ "$status" -ne 0 ]
  [[ "$output" == *"previous.json"* ]]
}
