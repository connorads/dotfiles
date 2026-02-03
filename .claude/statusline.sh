#!/bin/bash

# Claude Code status line with cost, context, duration and lines tracking
# Input: JSON from Claude Code via stdin

input=$(cat)

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

echo -e "$output"
