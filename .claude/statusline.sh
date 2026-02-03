#!/bin/bash

# Claude Code status line with cost, context, duration, lines and API limits
# Input: JSON from Claude Code via stdin

input=$(cat)

# --- API Usage Limits (cached for 60s) ---
CACHE="$HOME/.cache/claude-usage.json"
TTL=60

usage_5h=""
usage_7d=""

# Check cache freshness
cache_fresh=false
if [[ -f "$CACHE" ]]; then
    age=$(($(date +%s) - $(stat -f%m "$CACHE" 2>/dev/null || stat -c '%Y' "$CACHE" 2>/dev/null || echo 0)))
    [[ $age -lt $TTL ]] && cache_fresh=true
fi

if $cache_fresh; then
    usage_5h=$(jq -r '.five_hour.utilization // empty' "$CACHE" 2>/dev/null)
    usage_7d=$(jq -r '.seven_day.utilization // empty' "$CACHE" 2>/dev/null)
    reset_5h=$(jq -r '.five_hour.resets_at // empty' "$CACHE" 2>/dev/null)
    reset_7d=$(jq -r '.seven_day.resets_at // empty' "$CACHE" 2>/dev/null)
else
    # Get token from macOS Keychain
    token=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
    if [[ -n "$token" ]]; then
        resp=$(curl -s --max-time 2 "https://api.anthropic.com/api/oauth/usage" \
            -H "Authorization: Bearer $token" \
            -H "anthropic-beta: oauth-2025-04-20" \
            -H "User-Agent: claude-code/2.0.32" 2>/dev/null)
        if [[ -n "$resp" ]] && echo "$resp" | jq -e '.five_hour' >/dev/null 2>&1; then
            mkdir -p "$(dirname "$CACHE")"
            echo "$resp" > "$CACHE"
            usage_5h=$(echo "$resp" | jq -r '.five_hour.utilization // empty')
            usage_7d=$(echo "$resp" | jq -r '.seven_day.utilization // empty')
            reset_5h=$(echo "$resp" | jq -r '.five_hour.resets_at // empty')
            reset_7d=$(echo "$resp" | jq -r '.seven_day.resets_at // empty')
        fi
    fi
    # Fall back to stale cache if fetch failed
    if [[ -z "$usage_5h" && -f "$CACHE" ]]; then
        usage_5h=$(jq -r '.five_hour.utilization // empty' "$CACHE" 2>/dev/null)
        usage_7d=$(jq -r '.seven_day.utilization // empty' "$CACHE" 2>/dev/null)
        reset_5h=$(jq -r '.five_hour.resets_at // empty' "$CACHE" 2>/dev/null)
        reset_7d=$(jq -r '.seven_day.resets_at // empty' "$CACHE" 2>/dev/null)
    fi
fi

# Calculate time remaining until reset
time_remaining() {
    local reset_iso="$1"
    [[ -z "$reset_iso" ]] && return
    # Try GNU date first, then BSD date
    local reset_ts=$(date -d "$reset_iso" "+%s" 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${reset_iso%%.*}" "+%s" 2>/dev/null)
    [[ -z "$reset_ts" ]] && return
    local now=$(date +%s)
    local diff=$((reset_ts - now))
    [[ $diff -lt 0 ]] && diff=0
    local hrs=$((diff / 3600))
    local mins=$(((diff % 3600) / 60))
    if [[ $hrs -gt 23 ]]; then
        local days=$((hrs / 24))
        hrs=$((hrs % 24))
        echo "${days}d${hrs}h"
    elif [[ $hrs -gt 0 ]]; then
        echo "${hrs}h${mins}m"
    else
        echo "${mins}m"
    fi
}

reset_5h_str=$(time_remaining "$reset_5h")
reset_7d_str=$(time_remaining "$reset_7d")

# Extract values with jq, defaulting to empty/zero
dir=$(echo "$input" | jq -r '.workspace.current_dir // ""')
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

# Shorten directory (replace $HOME with ~)
dir="${dir/#$HOME/\~}"

# Get git branch if in repo
branch=""
if [ -n "$dir" ]; then
    real_dir="${dir/#\~/$HOME}"
    if [ -d "$real_dir" ]; then
        branch=$(git -C "$real_dir" branch --show-current 2>/dev/null)
        if [ -z "$branch" ]; then
            # Check if detached HEAD
            branch=$(git -C "$real_dir" rev-parse --short HEAD 2>/dev/null)
        fi
    fi
fi

# Format duration (ms → human readable)
duration_min=$((duration_ms / 60000))
if [ "$duration_min" -ge 60 ]; then
    duration_hrs=$((duration_min / 60))
    duration_min=$((duration_min % 60))
    duration_str="${duration_hrs}h${duration_min}m"
else
    duration_str="${duration_min}m"
fi

# Colours
RESET='\033[0m'
CYAN='\033[36m'
GREEN='\033[32m'
MAGENTA='\033[35m'
YELLOW='\033[33m'
RED='\033[31m'
WHITE='\033[37m'

# Colour-code cost (yellow default, red if > $5)
cost_colour="$YELLOW"
if (( $(echo "$cost > 5" | bc -l 2>/dev/null || echo 0) )); then
    cost_colour="$RED"
fi

# Colour-code context (white < 50%, yellow 50-80%, red > 80%)
ctx_colour="$WHITE"
ctx_int=${ctx_pct%.*}  # Remove decimal
if [ "$ctx_int" -gt 80 ] 2>/dev/null; then
    ctx_colour="$RED"
elif [ "$ctx_int" -gt 50 ] 2>/dev/null; then
    ctx_colour="$YELLOW"
fi

# Build output
output="${CYAN}${dir}${RESET}"

if [ -n "$branch" ]; then
    output+=" on ${GREEN}${branch}${RESET}"
fi

output+=" | ${MAGENTA}${model}${RESET}"
output+=" | ${cost_colour}\$$(printf '%.2f' "$cost")${RESET}"
output+=" | ${ctx_colour}${ctx_int:-0}% ctx${RESET}"
output+=" | ${WHITE}${duration_str}${RESET}"
output+=" | ${GREEN}+${lines_added}${RESET} ${RED}-${lines_removed}${RESET}"

# API usage limits (colour: white < 50%, yellow 50-80%, red > 80%)
if [[ -n "$usage_5h" ]]; then
    usage_5h_int=${usage_5h%.*}
    usage_7d_int=${usage_7d%.*}

    limit_5h_colour="$WHITE"
    [[ "${usage_5h_int:-0}" -gt 80 ]] && limit_5h_colour="$RED" || [[ "${usage_5h_int:-0}" -gt 50 ]] && limit_5h_colour="$YELLOW"

    limit_7d_colour="$WHITE"
    [[ "${usage_7d_int:-0}" -gt 80 ]] && limit_7d_colour="$RED" || [[ "${usage_7d_int:-0}" -gt 50 ]] && limit_7d_colour="$YELLOW"

    # Format: 5h:59%(2h30m) 7d:22%(4d12h)
    output+=" | ${limit_5h_colour}5h:${usage_5h_int:-0}%"
    [[ -n "$reset_5h_str" ]] && output+="(${reset_5h_str})"
    output+="${RESET} ${limit_7d_colour}7d:${usage_7d_int:-0}%"
    [[ -n "$reset_7d_str" ]] && output+="(${reset_7d_str})"
    output+="${RESET}"
fi

echo -e "$output"
