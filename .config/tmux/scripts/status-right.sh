#!/usr/bin/env bash

set -eu

width_raw="${1:-0}"
pane_path="${2:-$HOME}"
host_short="${3:-}"
host_full="${4:-}"
hostname_full_flag="${5:-}"

if ! [[ "$width_raw" =~ ^[0-9]+$ ]]; then
  width_raw=0
fi

cpu_script="$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh"
ram_script="$HOME/.config/tmux/plugins/tmux-cpu/scripts/ram_percentage.sh"

cpu_percentage() {
  if [ -x "$cpu_script" ]; then
    "$cpu_script" 2>/dev/null | tr -d '\n'
  else
    printf "--%%"
  fi
}

ram_percentage() {
  if [ -x "$ram_script" ]; then
    "$ram_script" 2>/dev/null | tr -d '\n'
  else
    printf "--%%"
  fi
}

disk_percentage() {
  local disk
  disk="$(df -h / 2>/dev/null | awk 'NR==2 { print $5; exit }')"
  if [ -n "$disk" ]; then
    printf "%s" "$disk"
  else
    printf "-"
  fi
}

git_branch_and_dirty() {
  local branch
  local dirty
  branch="-"
  dirty=""

  if [ -d "$pane_path" ] && cd "$pane_path" 2>/dev/null; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null | cut -c1-15)"
      if [ -z "$branch" ]; then
        branch="-"
      fi
      if ! git diff --quiet || ! git diff --cached --quiet; then
        dirty="*"
      fi
    fi
  fi

  printf "%s%s" "$branch" "$dirty"
}

host_label() {
  local short
  if [ -n "$hostname_full_flag" ]; then
    printf "%s" "$host_full"
    return
  fi

  short="$(printf "%s" "$host_short" | cut -c1-5)"
  if [ "${#host_short}" -gt 5 ]; then
    printf "%s…" "$short"
  else
    printf "%s" "$short"
  fi
}

print_full() {
  local cpu ram disk git_ref host
  cpu="$(cpu_percentage)"
  ram="$(ram_percentage)"
  disk="$(disk_percentage)"
  git_ref="$(git_branch_and_dirty)"
  host="$(host_label)"

  printf "#[fg=#313244]#[bg=#313244]#[fg=#f38ba8]#[bold]  %s " "$cpu"
  printf "#[fg=#45475a]#[bg=#45475a]#[fg=#cba6f7]#[bold]  %s " "$ram"
  printf "#[fg=#585b70]#[bg=#585b70]#[fg=#fab387]#[bold] 󰋊 %s " "$disk"
  printf "#[fg=#6c7086]#[bg=#6c7086]#[fg=#a6e3a1]  %s " "$git_ref"
  printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold]  %s" "$host"
}

print_medium() {
  local git_ref host
  git_ref="$(git_branch_and_dirty)"
  host="$(host_label)"

  printf "#[fg=#6c7086]#[bg=#6c7086]#[fg=#a6e3a1]  %s " "$git_ref"
  printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold]  %s" "$host"
}

print_compact() {
  local host
  host="$(host_label)"
  printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold]  %s" "$host"
}

if [ "$width_raw" -ge 120 ]; then
  print_full
elif [ "$width_raw" -ge 90 ]; then
  print_medium
else
  print_compact
fi
