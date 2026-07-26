#!/bin/sh
# wrap-track: dynamically wrap all prefix-table bindings with usage tracking
# Run once at config load (after TPM) via run-shell. Idempotent on reload.
set -e

TRACKER="$HOME/.config/tmux/scripts/track-bind.sh"
NOTEFILE="$(mktemp)"
KEYFILE="$(mktemp)"
TMPFILE="$(mktemp)"
trap 'rm -f "$NOTEFILE" "$KEYFILE" "$TMPFILE"' EXIT

# Capture tmux once per view. The join and transformation below happen in one
# AWK process; this keeps config reload cost proportional to tmux itself rather
# than spawning parsers for every binding.
tmux list-keys -N -T prefix >"$NOTEFILE"
tmux list-keys -T prefix >"$KEYFILE"

awk -v tracker="$TRACKER" '
  FILENAME == ARGV[1] {
    notes[++note_count] = $0
    next
  }

  {
    line = $0
    repeat = "n"
    if (sub(/^bind-key[[:space:]]+-r[[:space:]]+-T[[:space:]]+prefix[[:space:]]+/, "", line)) {
      repeat = "r"
    } else if (!sub(/^bind-key[[:space:]]+-T[[:space:]]+prefix[[:space:]]+/, "", line)) {
      next
    }

    key = line
    sub(/[[:space:]].*$/, "", key)
    cmd = line
    sub(/^[^[:space:]]+/, "", cmd)
    sub(/^[[:space:]]+/, "", cmd)

    if (cmd ~ /track-bind\.sh/) {
      original = cmd
      sub(/^run-shell[[:space:]]+-b[[:space:]]+"[^"]*track-bind\.sh[^"]*"[[:space:]]+\\;[[:space:]]*/, "", original)
      if (original == cmd) next
      cmd = original
    }

    if (key == "" || cmd == "" || cmd == key || key == "\\;") next
    binding_key[++binding_count] = key
    binding_repeat[binding_count] = repeat
    binding_cmd[binding_count] = cmd
    known_key[key] = 1
    known_key[unescape_key(key)] = 1
  }

  function strip_token(line) {
    sub(/^[^[:space:]]+[[:space:]]*/, "", line)
    return line
  }

  function unescape_key(key,    result, i, char) {
    result = ""
    for (i = 1; i <= length(key); i++) {
      char = substr(key, i, 1)
      if (char == "\\" && i < length(key)) {
        i++
        char = substr(key, i, 1)
      }
      result = result char
    }
    return result
  }

  function slug(value,    result) {
    result = tolower(value)
    gsub(/ /, "-", result)
    gsub(/[^a-z0-9-]/, "", result)
    return result
  }

  function safe_key(value,    result) {
    result = value
    gsub(/[^a-zA-Z0-9-]/, "", result)
    return result == "" ? "special" : result
  }

  function quote_double(value,    result) {
    result = value
    gsub(/\\/, "\\\\", result)
    gsub(/"/, "\\\"", result)
    return result
  }

  END {
    # New tmux prefixes annotation rows with the client prefix ("C-b key note");
    # older tmux starts with the key. Prefer the second token only when it names
    # a captured binding, which supports both forms without a third tmux query.
    for (i = 1; i <= note_count; i++) {
      raw = notes[i]
      first = raw
      sub(/[[:space:]].*$/, "", first)
      rest = strip_token(raw)
      second = rest
      sub(/[[:space:]].*$/, "", second)
      if (known_key[second]) {
        note_key = second
        note = strip_token(rest)
      } else {
        note_key = first
        note = rest
      }
      note_for[note_key] = note
      name_for[note_key] = slug(note)
    }

    for (i = 1; i <= binding_count; i++) {
      key = binding_key[i]
      lookup = key
      if (!(lookup in note_for)) lookup = unescape_key(key)
      note = note_for[lookup]
      name = name_for[lookup]
      if (name == "") name = safe_key(key)
      if (name == "") name = "special"

      nflag = note == "" ? "" : "-N \"" quote_double(note) "\" "
      rflag = binding_repeat[i] == "r" ? "-r " : ""
      printf "bind-key %s%s-T prefix %s run-shell -b \"sh %s %s %s #{q:session_name} #{window_index} #{pane_index} #{q:pane_current_path} #{q:host_short}\" \\; %s\n", \
        nflag, rflag, key, tracker, safe_key(key), name, binding_cmd[i]
    }
  }
' "$NOTEFILE" "$KEYFILE" >"$TMPFILE"

# Apply all wrapped bindings at once.
[ -s "$TMPFILE" ] && tmux source-file "$TMPFILE" || true
