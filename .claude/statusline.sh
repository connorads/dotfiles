#!/bin/bash

# Claude Code status line: context % | model | dir
# Input: JSON from Claude Code via stdin

input=$(cat)

# Extract values
dir=$(echo "$input" | jq -r '.workspace.current_dir // ""')
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
# Effort level: only emitted for effort-capable models (e.g. Opus 4.8, Sonnet 4.6); absent otherwise
effort=$(echo "$input" | jq -r '.effort.level // empty')

# Shorten directory (replace $HOME with ~)
dir="${dir/#$HOME/\~}"

# Get git branch if in repo
branch=""
if [ -n "$dir" ]; then
	real_dir="${dir/#\~/$HOME}"
	if [ -d "$real_dir" ]; then
		branch=$(git --no-optional-locks -C "$real_dir" branch --show-current 2>/dev/null)
		if [ -z "$branch" ]; then
			# Check if detached HEAD
			branch=$(git --no-optional-locks -C "$real_dir" rev-parse --short HEAD 2>/dev/null)
		fi
	fi
fi

# Colours
RESET='\033[0m'
CYAN='\033[36m'
GREEN='\033[32m'
MAGENTA='\033[35m'
YELLOW='\033[33m'
RED='\033[31m'
WHITE='\033[37m'
BLUE='\033[34m'
VIOLET='\033[38;5;141m'
DIM='\033[2m'

# Account tag: ccp sets CLAUDE_CONFIG_DIR per account (absent == personal ~/.claude).
# Show the profile's short label file, colour-coded, so the active account is
# obvious at a glance. Runs inside the claude process, so it needs no detection
# beyond its own inherited env - correct for fresh/resume/personal alike.
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
acct=$(cat "$cfg/label" 2>/dev/null) || acct=""
if [ -z "$acct" ]; then
	case "${cfg##*/}" in
	.claude) acct="per" ;;
	*) acct="${cfg##*/}" ;;
	esac
fi
# Colour the tag deterministically from the label so a given account is always
# the same colour, without naming any account in-repo. "per" (personal) is dim.
if [ "$acct" = "per" ]; then
	acct_col="$DIM$WHITE"
else
	palette=("$BLUE" "$VIOLET" "$CYAN" "$GREEN" "$YELLOW" "$RED")
	sum=0 i=0
	while [ "$i" -lt "${#acct}" ]; do
		printf -v code '%d' "'${acct:$i:1}"
		sum=$((sum + code))
		i=$((i + 1))
	done
	acct_col="${palette[$((sum % ${#palette[@]}))]}"
fi

# Effort: 5-step block ramp + label, colour by intensity (shows the *effective* level)
effort_seg=""
case "$effort" in
low) effort_seg=" ${DIM}${WHITE}▁ ${effort}${RESET}" ;;
medium) effort_seg=" ${CYAN}▃ ${effort}${RESET}" ;;
high) effort_seg=" ${GREEN}▅ ${effort}${RESET}" ;;
xhigh) effort_seg=" ${YELLOW}▆ ${effort}${RESET}" ;;
max) effort_seg=" ${RED}█ ${effort}${RESET}" ;;
esac

# Colour-code context (white < 50%, yellow 50-80%, red > 80%)
ctx_colour="$WHITE"
if [ -n "$ctx_pct" ]; then
	ctx_int=${ctx_pct%.*}
	if [ "$ctx_int" -gt 80 ] 2>/dev/null; then
		ctx_colour="$RED"
	elif [ "$ctx_int" -gt 50 ] 2>/dev/null; then
		ctx_colour="$YELLOW"
	fi
fi

# Build single-line output (context % | model+effort | dir)
line=""
if [ -n "$ctx_pct" ] && [ -n "$ctx_size" ]; then
	# Calculate used tokens and format as k
	used_tokens=$((ctx_size * ctx_int / 100))
	used_k=$((used_tokens / 1000))
	line+="${ctx_colour}${used_k}k (${ctx_int:-0}%)${RESET} | "
elif [ -n "$ctx_pct" ]; then
	line+="${ctx_colour}${ctx_int:-0}% ctx${RESET} | "
fi
if [ -n "$effort_seg" ]; then
	# effort_seg has a leading space; strip it so effort leads cleanly
	line+="${effort_seg# } ${MAGENTA}${model}${RESET} | ${CYAN}${dir}${RESET}"
else
	line+="${MAGENTA}${model}${RESET} | ${CYAN}${dir}${RESET}"
fi
[ -n "$branch" ] && line+=" on ${GREEN}${branch}${RESET}"

# Lead with the account tag (leftmost survives width truncation best)
line="${acct_col}${acct}${RESET} | ${line}"

printf "%b\n" "$line"
