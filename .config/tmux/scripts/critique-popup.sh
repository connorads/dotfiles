#!/usr/bin/env bash

set -u

run_critique() {
  if command -v critique >/dev/null 2>&1; then
    critique
    return $?
  fi

  if command -v mise >/dev/null 2>&1; then
    mise x -- critique
    return $?
  fi

  return 127
}

pause_with_message() {
  printf "%s\n" "$1"
  printf "Press Enter to close..."
  read -r _
}

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  run_critique
  status=$?
elif [ -d "$HOME/git/dotfiles" ] && [ "${PWD#"$HOME"}" != "$PWD" ]; then
  GIT_DIR="$HOME/git/dotfiles" GIT_WORK_TREE="$HOME" run_critique
  status=$?
else
  pause_with_message "critique: not in a git work tree"
  exit 1
fi

if [ "$status" -eq 127 ]; then
  pause_with_message "critique not found. Run: mise install"
  exit "$status"
fi

if [ "$status" -ne 0 ]; then
  pause_with_message "critique failed (exit $status)"
fi

exit "$status"
