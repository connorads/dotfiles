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

ai_usage() {
  local claude_cache="$HOME/.cache/claude-usage.json"
  local codex_cache="$HOME/.cache/codex-usage.json"
  local ttl=60 now bin="$HOME/.local/bin"
  now=$(date +%s)

  # Background refresh if cache is stale
  local mtime age
  for cf in "$claude_cache" "$codex_cache"; do
    if [ -f "$cf" ]; then
      mtime=$(stat -c '%Y' "$cf" 2>/dev/null || stat -f%m "$cf" 2>/dev/null || echo 0)
      age=$(( now - mtime ))
      if [ "$age" -ge "$ttl" ]; then
        case "$cf" in
          *claude*) [ -x "$bin/claude-usage" ] && "$bin/claude-usage" >/dev/null 2>&1 & ;;
          *codex*)  [ -x "$bin/codex-usage" ]  && "$bin/codex-usage"  >/dev/null 2>&1 & ;;
        esac
      fi
    fi
  done

  # Read percentages and remaining seconds from cache
  local claude_pct="" codex_pct=""
  local claude_remaining_secs="" codex_remaining_secs=""
  local claude_reset="" codex_reset=""

  if [ -f "$claude_cache" ]; then
    claude_pct=$(jq -r '.five_hour.utilization // empty' "$claude_cache" 2>/dev/null)
    local resets_at; resets_at=$(jq -r '.five_hour.resets_at // empty' "$claude_cache" 2>/dev/null)
    if [ -n "$resets_at" ]; then
      local reset_ts; reset_ts=$(date -d "$resets_at" +%s 2>/dev/null \
        || date -j -f "%Y-%m-%dT%H:%M:%S" "${resets_at%%.*}" +%s 2>/dev/null || echo 0)
      claude_remaining_secs=$(( reset_ts - now )); [ "$claude_remaining_secs" -lt 0 ] && claude_remaining_secs=0
      if [ "$claude_remaining_secs" -ge 3600 ]; then claude_reset="$(( (claude_remaining_secs + 1800) / 3600 ))h"
      else claude_reset="$(( claude_remaining_secs / 60 ))m"; fi
    fi
  fi

  if [ -f "$codex_cache" ]; then
    codex_pct=$(jq -r '.rate_limit.primary_window.used_percent // empty' "$codex_cache" 2>/dev/null)
    local reset_secs; reset_secs=$(jq -r '.rate_limit.primary_window.reset_after_seconds // empty' "$codex_cache" 2>/dev/null)
    if [ -n "$reset_secs" ]; then
      # reset_after_seconds is relative to cache write time — subtract elapsed
      local cache_mt; cache_mt=$(stat -c '%Y' "$codex_cache" 2>/dev/null \
        || stat -f%m "$codex_cache" 2>/dev/null || echo "$now")
      codex_remaining_secs=$(( reset_secs - (now - cache_mt) )); [ "$codex_remaining_secs" -lt 0 ] && codex_remaining_secs=0
      if [ "$codex_remaining_secs" -ge 3600 ]; then codex_reset="$(( (codex_remaining_secs + 1800) / 3600 ))h"
      else codex_reset="$(( codex_remaining_secs / 60 ))m"; fi
    fi
  fi

  [ -z "$claude_pct" ] && [ -z "$codex_pct" ] && return

  # Pace-based colour: compare usage% against elapsed% of 5h window
  # pace = usage% / elapsed%, green <1.2, yellow 1.2-1.4, red >=1.4
  _usage_colour() {
    local usage_pct=$1 remaining_secs=$2
    local usage_int=${usage_pct%.*}
    usage_int=${usage_int:-0}

    # No usage → green
    if [ "$usage_int" -le 0 ] 2>/dev/null; then echo "a6e3a1"; return; fi

    local elapsed_secs=$(( 18000 - remaining_secs ))
    # Early window (<3min elapsed) → green (pace too unstable)
    if [ "$elapsed_secs" -lt 180 ]; then echo "a6e3a1"; return; fi

    local elapsed_pct=$(( elapsed_secs * 100 / 18000 ))
    [ "$elapsed_pct" -le 0 ] && elapsed_pct=1

    local pace_x100=$(( usage_int * 100 / elapsed_pct ))
    if [ "$pace_x100" -ge 140 ]; then echo "f38ba8"
    elif [ "$pace_x100" -ge 120 ]; then echo "f9e2af"
    else echo "a6e3a1"; fi
  }

  local dim="#7f849c"

  # Build segment: powerline separator then colour-coded labels
  local out="#[fg=#232334]#[bg=#232334]"

  if [ -n "$claude_pct" ]; then
    local cc; cc=$(_usage_colour "$claude_pct" "${claude_remaining_secs:-18000}")
    local ci; ci=$(printf "%.0f" "$claude_pct" 2>/dev/null || echo "$claude_pct")
    out+="#[fg=#${cc}] C:${ci}%"
    [ -n "$claude_reset" ] && out+="#[fg=${dim}]·${claude_reset}"
  fi
  if [ -n "$codex_pct" ]; then
    local xc; xc=$(_usage_colour "$codex_pct" "${codex_remaining_secs:-18000}")
    local xi; xi=$(printf "%.0f" "$codex_pct" 2>/dev/null || echo "$codex_pct")
    out+="#[fg=#${xc}] X:${xi}%"
    [ -n "$codex_reset" ] && out+="#[fg=${dim}]·${codex_reset}"
  fi
  out+=" "

  printf "%s" "$out"
}

print_full() {
  local cpu ram disk git_ref host
  cpu="$(cpu_percentage)"
  ram="$(ram_percentage)"
  disk="$(disk_percentage)"
  git_ref="$(git_branch_and_dirty)"
  host="$(host_label)"

  ai_usage
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

# Reboot-required indicator (visible at all widths)
if [ -f /var/run/reboot-required ]; then
  printf "#[fg=#1e1e2e]#[bg=#f38ba8]#[bold] ⟳ REBOOT #[bg=#1e1e2e]#[fg=#f38ba8] "
fi

if [ "$width_raw" -ge 120 ]; then
  print_full
elif [ "$width_raw" -ge 90 ]; then
  print_medium
elif [ "$width_raw" -ge 60 ]; then
  print_compact
fi
# < 60: output nothing except reboot indicator (mobile — maximise window tab space)
