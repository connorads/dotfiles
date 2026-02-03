#!/bin/bash

# Claude Code status line with cost, context, and cache tracking
# Input: JSON from Claude Code via stdin

input=$(cat)

# Extract values with jq, defaulting to empty/zero
dir=$(echo "$input" | jq -r '.workspace.current_dir // ""')
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
cache_read=$(echo "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
cache_create=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
input_tokens=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')

# Total = all input token types
total_input=$((cache_read + cache_create + input_tokens))

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

# Calculate cache rate (percentage of input tokens from cache)
cache_rate=0
if [ "$total_input" -gt 0 ] 2>/dev/null; then
    cache_rate=$(echo "scale=0; $cache_read * 100 / $total_input" | bc 2>/dev/null || echo "0")
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

# Colour-code cache (green >= 50%, yellow 20-50%, red < 20%)
cache_colour="$GREEN"
if [ "$cache_rate" -lt 20 ] 2>/dev/null; then
    cache_colour="$RED"
elif [ "$cache_rate" -lt 50 ] 2>/dev/null; then
    cache_colour="$YELLOW"
fi

# Build output
output="${CYAN}${dir}${RESET}"

if [ -n "$branch" ]; then
    output+=" on ${GREEN}${branch}${RESET}"
fi

output+=" | ${MAGENTA}${model}${RESET}"
output+=" | ${cost_colour}\$$(printf '%.2f' "$cost")${RESET}"
output+=" | ${ctx_colour}${ctx_int:-0}% ctx${RESET}"
output+=" | ${cache_colour}${cache_rate}% cache${RESET}"

echo -e "$output"
