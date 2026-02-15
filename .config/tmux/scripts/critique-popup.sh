#!/usr/bin/env bash

set -u

run_critique() {
  if command -v critique >/dev/null 2>&1; then
    critique "$@"
    return $?
  fi

  if command -v mise >/dev/null 2>&1; then
    mise x -- critique "$@"
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

is_home_root_path() {
  [ "${1%/}" = "${HOME%/}" ]
}

has_changes_repo() {
  [ -n "$(git -C "$1" status --porcelain --untracked-files=all 2>/dev/null)" ]
}

has_changes_dotfiles() {
  [ -n "$(git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME" status --porcelain --untracked-files=all 2>/dev/null)" ]
}

open_popup() {
  local pane_path mode action agent
  pane_path="$1"
  mode="$2"
  action="$3"
  agent="$4"

  tmux display-popup -E -h 95% -w 100% -d "$pane_path" \
    "$HOME/.config/tmux/scripts/critique-popup.sh --exec $mode $action $agent"
}

normalize_action() {
  case "${1:-diff}" in
    diff|review)
      printf "%s" "$1"
      ;;
    *)
      printf "diff"
      ;;
  esac
}

normalize_agent() {
  local raw agent
  raw="${1:-opencode}"
  agent="$(printf "%s" "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

  case "$agent" in
    ""|opencode|claude)
      printf "%s" "${agent:-opencode}"
      ;;
    *)
      printf "opencode"
      ;;
  esac
}

action_label() {
  case "$1" in
    review)
      printf "critique review (%s)" "$2"
      ;;
    *)
      printf "critique"
      ;;
  esac
}

run_action() {
  local action agent
  action="$1"
  agent="$2"

  case "$action" in
    review)
      run_critique review --agent "$agent"
      ;;
    *)
      run_critique
      ;;
  esac
}

run_in_popup() {
  local mode action agent label status
  mode="$1"
  action="$(normalize_action "${2:-diff}")"
  agent="$(normalize_agent "${3:-opencode}")"
  label="$(action_label "$action" "$agent")"

  case "$mode" in
    normal)
      run_action "$action" "$agent"
      status=$?
      ;;
    dotfiles)
      GIT_DIR="$HOME/git/dotfiles" GIT_WORK_TREE="$HOME" run_action "$action" "$agent"
      status=$?
      ;;
    *)
      if is_in_git_repo "$PWD"; then
        run_action "$action" "$agent"
        status=$?
      elif [ -d "$HOME/git/dotfiles" ] && is_home_root_path "$PWD"; then
        GIT_DIR="$HOME/git/dotfiles" GIT_WORK_TREE="$HOME" run_action "$action" "$agent"
        status=$?
      else
        pause_with_message "$label: not in a git work tree"
        exit 1
      fi
      ;;
  esac

  if [ "$status" -eq 127 ]; then
    pause_with_message "$label not found. Run: mise install"
    exit "$status"
  fi

  if [ "$status" -ne 0 ]; then
    pause_with_message "$label failed (exit $status)"
  fi

  exit "$status"
}

preflight() {
  local action agent label pane_path
  pane_path="${1:-$PWD}"
  action="$(normalize_action "${2:-diff}")"
  agent="$(normalize_agent "${3:-opencode}")"
  label="$(action_label "$action" "$agent")"

  if is_in_git_repo "$pane_path"; then
    if has_changes_repo "$pane_path"; then
      open_popup "$pane_path" normal "$action" "$agent"
    else
      tmux display-message "$label: no changes"
    fi
    return
  fi

  if [ -d "$HOME/git/dotfiles" ] && is_home_root_path "$pane_path"; then
    if has_changes_dotfiles; then
      open_popup "$pane_path" dotfiles "$action" "$agent"
    else
      tmux display-message "$label: no changes"
    fi
    return
  fi

  tmux display-message "$label: not in a git work tree"
}

if [ "${1:-}" = "--exec" ]; then
  run_in_popup "${2:-auto}" "${3:-diff}" "${4:-opencode}"
else
  preflight "${1:-$PWD}" "${2:-diff}" "${3:-opencode}"
fi
