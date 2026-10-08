#!/bin/bash

# Claude Code status line: context % | model | dir | account quota | prompt cache
# Input: JSON from Claude Code via stdin

input=$(cat)

# Extract values
dir=$(echo "$input" | jq -r '.workspace.current_dir // ""')
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
# Effort level: only emitted for effort-capable models (e.g. Opus 4.8, Sonnet 4.6); absent otherwise
effort=$(echo "$input" | jq -r '.effort.level // empty')
# Prompt cache (main thread only; absent before the first API response).
# Unit-separated so empty fields survive `read` (tab IFS would collapse them).
IFS=$'\x1f' read -r pc_present pc_observed pc_ttl pc_expires pc_hit pc_misses pc_causes pc_recache last_write last_read < <(
	echo "$input" | jq -r '
		.prompt_cache as $p | .context_window.current_usage as $u |
		[ ($p != null), ($p.caching_observed // false), ($p.ttl // ""),
		  ($p.expires_at // ""), ($p.hit_ratio // ""), ($p.misses // 0),
		  (($p.last_miss_cause.causes // []) | join(",")),
		  ($p.recache_tokens_if_cold // ""),
		  ($u.cache_creation_input_tokens // ""), ($u.cache_read_input_tokens // "") ]
		| map(tostring) | join("\u001f")'
)

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

# Account tag: ccp sets CLAUDE_CONFIG_DIR per account (absent == default ~/.claude).
# Show the profile's short label file, colour-coded, so the active account is
# obvious at a glance. Runs inside the claude process, so it needs no detection
# beyond its own inherited env - correct for fresh/resume/default alike. The
# derivation lives in profile-label.sh so the pane-border tag can never disagree.
# shellcheck source=hooks/profile-label.sh disable=SC1091
. "$HOME/.claude/hooks/profile-label.sh"
acct=$(claude_profile_label)
# Colour the tag deterministically from the label so a given account is always
# the same colour, without naming any account in-repo. "def" (default) is dim.
if [ "$acct" = "def" ]; then
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

# Token count as 950 / 1.3k / 130k
fmt_k() {
	local n=$1
	if [ "$n" -lt 1000 ]; then
		printf '%d' "$n"
	elif [ "$n" -lt 10000 ]; then
		printf '%d.%dk' $((n / 1000)) $((n % 1000 / 100))
	else
		printf '%dk' $((n / 1000))
	fi
}

now=$(date +%s)

fmt_reset() {
	local reset=$1 minutes
	if [ -z "$reset" ]; then
		printf '?'
	elif [ "$reset" -le "$now" ]; then
		printf 'refresh needed'
	else
		minutes=$(((reset - now + 59) / 60))
		if [ "$minutes" -ge 1440 ]; then
			printf '%dd %dh' $((minutes / 1440)) $((minutes % 1440 / 60))
		elif [ "$minutes" -ge 60 ]; then
			printf '%dh %dm' $((minutes / 60)) $((minutes % 60))
		else
			printf '%dm' "$minutes"
		fi
	fi
}

# Native quota data belongs to the account running this session.
usage_seg=""
while IFS=$'\t' read -r label pct pct_int resets; do
	usage_colour="$GREEN"
	if [ "$pct_int" -ge 90 ]; then
		usage_colour="$RED"
	elif [ "$pct_int" -ge 70 ]; then
		usage_colour="$YELLOW"
	fi
	[ -n "$usage_seg" ] && usage_seg+=" | "
	usage_seg+="${usage_colour}${label} ${pct}%${RESET} ↻ $(fmt_reset "$resets")"
done < <(
	echo "$input" | jq -r '
		[["five_hour", "5h"], ["seven_day", "weekly"]][] as $window
		| .rate_limits[$window[0]]
		| select(.used_percentage | type == "number")
		| [$window[1], .used_percentage, (.used_percentage | floor),
		   (.resets_at | if type == "number" then floor else "" end)]
		| @tsv'
)
if [ -n "$usage_seg" ]; then
	usage_seg="usage ${usage_seg}"
else
	usage_seg="${DIM}${WHITE}usage unavailable${RESET}"
fi

# Cache: warm -> TTL countdown, hit %, last turn write/read, misses + last cause;
# cold -> tokens the next request re-caches. Countdown colour by TTL fraction left.
cache_seg=""
if [ "$pc_present" = "true" ]; then
	if [ "$pc_observed" != "true" ]; then
		cache_seg="${DIM}${WHITE}cache off${RESET}"
	else
		left=0
		[ -n "$pc_expires" ] && left=$((pc_expires - now))
		if [ "$left" -gt 0 ]; then
			case "$pc_ttl" in 1h) ttl_s=3600 ;; *) ttl_s=300 ;; esac
			if [ $((left * 100 / ttl_s)) -gt 50 ]; then
				ttl_col="$GREEN"
			elif [ $((left * 100 / ttl_s)) -gt 20 ]; then
				ttl_col="$YELLOW"
			else
				ttl_col="$RED"
			fi
			cache_seg="${ttl_col}● ${pc_ttl} $(printf '%d:%02d' $((left / 60)) $((left % 60)))${RESET}"
		else
			cache_seg="${RED}○ cold${RESET}"
			[ -n "$pc_recache" ] && cache_seg+=" · rebuild $(fmt_k "$pc_recache")"
		fi
		[ -n "$pc_hit" ] && cache_seg+=" · hit $(awk -v r="$pc_hit" 'BEGIN { printf "%d%%", r * 100 + 0.5 }')"
		[ -n "$last_write" ] && [ -n "$last_read" ] &&
			cache_seg+=" · ${DIM}+$(fmt_k "$last_write")/$(fmt_k "$last_read")${RESET}"
		if [ "$pc_misses" -gt 0 ] 2>/dev/null; then
			cache_seg+=" · ${YELLOW}${pc_misses} miss${RESET}"
			[ -n "$pc_causes" ] && cache_seg+=" (${pc_causes})"
		fi
	fi
fi

# Build single-line output (context % | model+effort | dir | quota | cache)
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
line+=" | ${usage_seg}"
[ -n "$cache_seg" ] && line+=" | ${cache_seg}"

# Lead with the account tag (leftmost survives width truncation best)
line="${acct_col}${acct}${RESET} | ${line}"

printf "%b\n" "$line"
