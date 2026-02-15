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

is_in_git_repo() {
  git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

is_home_path() {
  [ "${1#"$HOME"}" != "$1" ]
}

has_changes_repo() {
  [ -n "$(git -C "$1" status --porcelain --untracked-files=all 2>/dev/null)" ]
}

has_changes_dotfiles() {
  [ -n "$(git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" status --porcelain --untracked-files=all 2>/dev/null)" ]
}

open_popup() {
  local pane_path mode
  pane_path="$1"
  mode="$2"

  tmux display-popup -E -h 95% -w 100% -d "$pane_path" \
    "$HOME/.config/tmux/scripts/critique-popup.sh --exec $mode"
}

run_in_popup() {
  local mode status
  mode="$1"

  case "$mode" in
    normal)
      run_critique
      status=$?
      ;;
    dotfiles)
      GIT_DIR="$HOME/git/dotfiles" GIT_WORK_TREE="$HOME" run_critique
      status=$?
      ;;
    *)
      if is_in_git_repo "$PWD"; then
        run_critique
        status=$?
      elif [ -d "$HOME/git/dotfiles" ] && is_home_path "$PWD"; then
        GIT_DIR="$HOME/git/dotfiles" GIT_WORK_TREE="$HOME" run_critique
        status=$?
      else
        pause_with_message "critique: not in a git work tree"
        exit 1
      fi
      ;;
  esac

  if [ "$status" -eq 127 ]; then
    pause_with_message "critique not found. Run: mise install"
    exit "$status"
  fi

  if [ "$status" -ne 0 ]; then
    pause_with_message "critique failed (exit $status)"
  fi

  exit "$status"
}

preflight() {
  local pane_path
  pane_path="${1:-$PWD}"

  if is_in_git_repo "$pane_path"; then
    if has_changes_repo "$pane_path"; then
      open_popup "$pane_path" normal
    else
      tmux display-message "critique: no changes"
    fi
    return
  fi

  if [ -d "$HOME/git/dotfiles" ] && is_home_path "$pane_path"; then
    if has_changes_dotfiles; then
      open_popup "$pane_path" dotfiles
    else
      tmux display-message "critique: no changes"
    fi
    return
  fi

  tmux display-message "critique: not in a git work tree"
}

if [ "${1:-}" = "--exec" ]; then
  run_in_popup "${2:-auto}"
else
  preflight "${1:-$PWD}"
fi
