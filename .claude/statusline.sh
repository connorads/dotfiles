#!/bin/bash

# Claude Code status line with cost, context, duration, lines and API limits
# Input: JSON from Claude Code via stdin

input=$(cat)

# --- API Usage Limits (cache-only render; claude-usage handles fetch/backoff) ---
CACHE="$HOME/.cache/claude-usage.json"
META="$HOME/.cache/claude-usage.meta.json"
LOCKDIR="$HOME/.cache/claude-usage.lock"
TRIGGER="$HOME/.cache/claude-usage.trigger"
TTL=300
TRIGGER_TTL=60

usage_5h=""
usage_7d=""

cache_fresh=false
cache_stale=false
now=$(date +%s)
cache_age=999999

if [[ -f "$CACHE" ]]; then
	cache_mtime=$(stat -f%m "$CACHE" 2>/dev/null || stat -c '%Y' "$CACHE" 2>/dev/null || echo 0)
	cache_age=$((now - cache_mtime))
	[[ $cache_age -lt $TTL ]] && cache_fresh=true || cache_stale=true

	usage_5h=$(jq -r '.five_hour.utilization // empty' "$CACHE" 2>/dev/null)
	usage_7d=$(jq -r '.seven_day.utilization // empty' "$CACHE" 2>/dev/null)
	reset_5h=$(jq -r '.five_hour.resets_at // empty' "$CACHE" 2>/dev/null)
	reset_7d=$(jq -r '.seven_day.resets_at // empty' "$CACHE" 2>/dev/null)
fi

# Trigger a background refresh conservatively (single-writer, backoff-aware)
if [[ "$cache_fresh" == false ]] && command -v claude-usage >/dev/null 2>&1; then
	next_retry=$(jq -r '.next_retry_at // 0' "$META" 2>/dev/null || echo 0)
	trigger_ok=true
	if [[ -f "$TRIGGER" ]]; then
		trigger_mtime=$(stat -f%m "$TRIGGER" 2>/dev/null || stat -c '%Y' "$TRIGGER" 2>/dev/null || echo 0)
		trigger_age=$((now - trigger_mtime))
		[[ $trigger_age -lt $TRIGGER_TTL ]] && trigger_ok=false
	fi

	if [[ "$now" -ge "$next_retry" ]] && [[ ! -d "$LOCKDIR" ]] && [[ "$trigger_ok" == true ]]; then
		mkdir -p "$(dirname "$TRIGGER")"
		: >"$TRIGGER"
		claude-usage >/dev/null 2>&1 &
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
	if [[ $diff -le 0 ]]; then
		if [[ "$cache_stale" == true ]]; then
			echo "stale"
			return
		fi
		diff=0
	fi
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

remaining_seconds() {
	local reset_iso="$1"
	[[ -z "$reset_iso" ]] && return
	# Try GNU date first, then BSD date
	local reset_ts=$(date -d "$reset_iso" "+%s" 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${reset_iso%%.*}" "+%s" 2>/dev/null)
	[[ -z "$reset_ts" ]] && return
	local now=$(date +%s)
	local diff=$((reset_ts - now))
	[[ $diff -lt 0 ]] && diff=0
	echo "$diff"
}

elapsed_pct() {
	local window_seconds="$1"
	local reset_iso="$2"
	[[ -z "$window_seconds" || -z "$reset_iso" ]] && return
	local rem=$(remaining_seconds "$reset_iso")
	[[ -z "$rem" ]] && return
	[[ $rem -gt $window_seconds ]] && rem=$window_seconds
	local elapsed=$((window_seconds - rem))
	echo $((elapsed * 100 / window_seconds))
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
if (($(echo "$cost > 5" | bc -l 2>/dev/null || echo 0))); then
	cost_colour="$RED"
fi

# Colour-code context (white < 50%, yellow 50-80%, red > 80%)
ctx_colour="$WHITE"
ctx_int=${ctx_pct%.*} # Remove decimal
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

# API usage limits (colour based on usage pace vs elapsed time)
if [[ -n "$usage_5h" ]]; then
	usage_5h_int=${usage_5h%.*}
	usage_7d_int=${usage_7d%.*}

	elapsed_5h_pct=$(elapsed_pct 18000 "$reset_5h")
	elapsed_7d_pct=$(elapsed_pct 604800 "$reset_7d")

	limit_5h_colour="$WHITE"
	if [[ -n "$elapsed_5h_pct" ]]; then
		[[ "$elapsed_5h_pct" -lt 1 ]] && elapsed_5h_pct=1
		pace_5h=$(echo "scale=3; $usage_5h / $elapsed_5h_pct" | bc -l 2>/dev/null || echo 0)
		if (($(echo "$pace_5h >= 1.4" | bc -l 2>/dev/null || echo 0))); then
			limit_5h_colour="$RED"
		elif (($(echo "$pace_5h >= 1.2" | bc -l 2>/dev/null || echo 0))); then
			limit_5h_colour="$YELLOW"
		fi
	fi

	limit_7d_colour="$WHITE"
	if [[ -n "$elapsed_7d_pct" ]]; then
		[[ "$elapsed_7d_pct" -lt 1 ]] && elapsed_7d_pct=1
		pace_7d=$(echo "scale=3; $usage_7d / $elapsed_7d_pct" | bc -l 2>/dev/null || echo 0)
		if (($(echo "$pace_7d >= 1.4" | bc -l 2>/dev/null || echo 0))); then
			limit_7d_colour="$RED"
		elif (($(echo "$pace_7d >= 1.2" | bc -l 2>/dev/null || echo 0))); then
			limit_7d_colour="$YELLOW"
		fi
	fi

	# Format: 5h:59%(2h30m) 7d:22%(4d12h)
	output+=" | ${limit_5h_colour}5h:${usage_5h_int:-0}%"
	[[ -n "$reset_5h_str" ]] && output+="(${reset_5h_str})"
	output+="${RESET} ${limit_7d_colour}7d:${usage_7d_int:-0}%"
	[[ -n "$reset_7d_str" ]] && output+="(${reset_7d_str})"
	output+="${RESET}"
fi

echo -e "$output"
