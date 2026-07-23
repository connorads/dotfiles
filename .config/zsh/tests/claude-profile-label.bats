#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

# Pure unit test for the shared label derivation. Source the POSIX-sh lib and
# call claude_profile_label directly against fixture config dirs - no tmux, no
# claude, no server. This is the single source of truth the statusline and the
# pane-border tag both consume, so its fallback rules are pinned here.

LIB="$BATS_TEST_DIRNAME/../../../.claude/hooks/profile-label.sh"

setup() {
  [ -f "$LIB" ] || skip "profile-label.sh not found at $LIB"
  # shellcheck source=/dev/null
  . "$LIB"
}

@test "label file present and non-empty returns its contents" {
  cfg="$BATS_TEST_TMPDIR/stretch"
  mkdir -p "$cfg"
  printf 'str' >"$cfg/label"
  [ "$(claude_profile_label "$cfg")" = "str" ]
}

@test "empty label file falls back to the basename" {
  cfg="$BATS_TEST_TMPDIR/work"
  mkdir -p "$cfg"
  : >"$cfg/label"
  [ "$(claude_profile_label "$cfg")" = "work" ]
}

@test "no label file with .claude basename returns def" {
  cfg="$BATS_TEST_TMPDIR/.claude"
  mkdir -p "$cfg"
  [ "$(claude_profile_label "$cfg")" = "def" ]
}

@test "no label file with a named basename returns the basename" {
  cfg="$BATS_TEST_TMPDIR/stretch"
  mkdir -p "$cfg"
  [ "$(claude_profile_label "$cfg")" = "stretch" ]
}

@test "no arg uses CLAUDE_CONFIG_DIR when set" {
  cfg="$BATS_TEST_TMPDIR/acme"
  mkdir -p "$cfg"
  printf 'acm' >"$cfg/label"
  CLAUDE_CONFIG_DIR="$cfg" run -0 claude_profile_label
  [ "$output" = "acm" ]
}

@test "no arg and no CLAUDE_CONFIG_DIR defaults to HOME/.claude -> def" {
  home="$BATS_TEST_TMPDIR/home"
  mkdir -p "$home/.claude"
  HOME="$home" run -0 env -u CLAUDE_CONFIG_DIR bash -c ". '$LIB'; claude_profile_label"
  [ "$output" = "def" ]
}
