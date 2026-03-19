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

ssh_info() {
	local count=0
	if [ "$(uname)" = "Darwin" ]; then
		count="$(lsof -iTCP:22 -sTCP:ESTABLISHED -n -P 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
	else
		count="$(ss -tn state established '( sport = :22 )' 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
	fi

	[ "$count" -eq 0 ] 2>/dev/null && return

	local agent=""
	if SSH_AUTH_SOCK="$HOME/.ssh/agent.sock" timeout 1 ssh-add -l >/dev/null 2>&1; then
		agent="#[fg=#a6e3a1]🔑"
	fi

	printf "#[fg=#fab387]%s↓%s " "$count" "$agent"
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
	local claude_meta="$HOME/.cache/claude-usage.meta.json"
	local claude_lock="$HOME/.cache/claude-usage.lock"
	local claude_trigger="$HOME/.cache/claude-usage.trigger"
	local codex_cache="$HOME/.cache/codex-usage.json"
	local codex_meta="$HOME/.cache/codex-usage.meta.json"
	local codex_lock="$HOME/.cache/codex-usage.lock"
	local codex_trigger="$HOME/.cache/codex-usage.trigger"
	local ttl=300 trigger_ttl=60 now bin="$HOME/.local/bin"
	now=$(date +%s)

	_mtime() {
		local file="$1"
		stat -c '%Y' "$file" 2>/dev/null || stat -f%m "$file" 2>/dev/null || echo 0
	}

	_should_trigger_refresh() {
		local cache="$1"
		local meta="$2"
		local lockdir="$3"
		local trigger="$4"
		local next_retry trigger_age cache_age cache_mtime trigger_mtime

		if [ -f "$cache" ]; then
			cache_mtime=$(_mtime "$cache")
			cache_age=$((now - cache_mtime))
			[ "$cache_age" -lt "$ttl" ] && return 1
		fi

		next_retry=$(jq -r '.next_retry_at // 0' "$meta" 2>/dev/null || echo 0)
		[ "$now" -lt "$next_retry" ] && return 1
		[ -d "$lockdir" ] && return 1

		if [ -f "$trigger" ]; then
			trigger_mtime=$(_mtime "$trigger")
			trigger_age=$((now - trigger_mtime))
			[ "$trigger_age" -lt "$trigger_ttl" ] && return 1
		fi

		return 0
	}

	if [ -x "$bin/claude-usage" ] && _should_trigger_refresh "$claude_cache" "$claude_meta" "$claude_lock" "$claude_trigger"; then
		mkdir -p "$(dirname "$claude_trigger")"
		: >"$claude_trigger"
		"$bin/claude-usage" >/dev/null 2>&1 &
	fi

	if [ -x "$bin/codex-usage" ] && _should_trigger_refresh "$codex_cache" "$codex_meta" "$codex_lock" "$codex_trigger"; then
		mkdir -p "$(dirname "$codex_trigger")"
		: >"$codex_trigger"
		"$bin/codex-usage" >/dev/null 2>&1 &
	fi

	# Read percentages and remaining seconds from cache
	local claude_pct="" codex_pct=""
	local claude_remaining_secs="" codex_remaining_secs=""
	local claude_reset="" codex_reset=""
	local claude_cache_age=999999 codex_cache_age=999999
	local claude_stale=0 codex_stale=0

	if [ -f "$claude_cache" ]; then
		claude_cache_age=$((now - $(_mtime "$claude_cache")))
		claude_pct=$(jq -r '.five_hour.utilization // empty' "$claude_cache" 2>/dev/null)
		local resets_at
		resets_at=$(jq -r '.five_hour.resets_at // empty' "$claude_cache" 2>/dev/null)
		if [ -n "$resets_at" ]; then
			local reset_ts
			reset_ts=$(date -d "$resets_at" +%s 2>/dev/null ||
				date -j -f "%Y-%m-%dT%H:%M:%S" "${resets_at%%.*}" +%s 2>/dev/null || echo 0)
			claude_remaining_secs=$((reset_ts - now))
			[ "$claude_remaining_secs" -lt 0 ] && claude_remaining_secs=0
			if [ "$claude_remaining_secs" -eq 0 ] && [ "$claude_cache_age" -ge "$ttl" ]; then
				claude_reset="stale"
				claude_stale=1
			elif [ "$claude_remaining_secs" -ge 3600 ]; then
				claude_reset="$(((claude_remaining_secs + 1800) / 3600))h"
			else
				claude_reset="$((claude_remaining_secs / 60))m"
			fi
		fi
	fi

	if [ -f "$codex_cache" ]; then
		codex_cache_age=$((now - $(_mtime "$codex_cache")))
		codex_pct=$(jq -r '.rate_limit.primary_window.used_percent // empty' "$codex_cache" 2>/dev/null)
		local reset_secs
		reset_secs=$(jq -r '.rate_limit.primary_window.reset_after_seconds // empty' "$codex_cache" 2>/dev/null)
		if [ -n "$reset_secs" ]; then
			# reset_after_seconds is relative to cache write time — subtract elapsed
			local cache_mt
			cache_mt=$(_mtime "$codex_cache")
			codex_remaining_secs=$((reset_secs - (now - cache_mt)))
			[ "$codex_remaining_secs" -lt 0 ] && codex_remaining_secs=0
			if [ "$codex_remaining_secs" -eq 0 ] && [ "$codex_cache_age" -ge "$ttl" ]; then
				codex_reset="stale"
				codex_stale=1
			elif [ "$codex_remaining_secs" -ge 3600 ]; then
				codex_reset="$(((codex_remaining_secs + 1800) / 3600))h"
			else
				codex_reset="$((codex_remaining_secs / 60))m"
			fi
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
		if [ "$usage_int" -le 0 ] 2>/dev/null; then
			echo "a6e3a1"
			return
		fi

		local elapsed_secs=$((18000 - remaining_secs))
		# Early window (<3min elapsed) → green (pace too unstable)
		if [ "$elapsed_secs" -lt 180 ]; then
			echo "a6e3a1"
			return
		fi

		local elapsed_pct=$((elapsed_secs * 100 / 18000))
		[ "$elapsed_pct" -le 0 ] && elapsed_pct=1

		local pace_x100=$((usage_int * 100 / elapsed_pct))
		if [ "$pace_x100" -ge 140 ]; then
			echo "f38ba8"
		elif [ "$pace_x100" -ge 120 ]; then
			echo "f9e2af"
		else echo "a6e3a1"; fi
	}

	local dim="#7f849c"

	# Build segment: powerline separator then colour-coded labels
	local out="#[fg=#232334]#[bg=#232334]"

	if [ -n "$claude_pct" ]; then
		local cc
		if [ "$claude_stale" -eq 1 ]; then
			cc="$dim"
		else
			cc=$(_usage_colour "$claude_pct" "${claude_remaining_secs:-18000}")
		fi
		local ci
		ci=$(printf "%.0f" "$claude_pct" 2>/dev/null || echo "$claude_pct")
		out+="#[fg=#${cc}] C:${ci}%"
		[ -n "$claude_reset" ] && out+="#[fg=${dim}]·${claude_reset}"
	fi
	if [ -n "$codex_pct" ]; then
		local xc
		if [ "$codex_stale" -eq 1 ]; then
			xc="$dim"
		else
			xc=$(_usage_colour "$codex_pct" "${codex_remaining_secs:-18000}")
		fi
		local xi
		xi=$(printf "%.0f" "$codex_pct" 2>/dev/null || echo "$codex_pct")
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
	ssh_info
	printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold]  %s" "$host"
}

print_medium() {
	local git_ref host
	git_ref="$(git_branch_and_dirty)"
	host="$(host_label)"

	printf "#[fg=#6c7086]#[bg=#6c7086]#[fg=#a6e3a1]  %s " "$git_ref"
	ssh_info
	printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold]  %s" "$host"
}

print_compact() {
	local host
	host="$(host_label)"
	ssh_info
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
