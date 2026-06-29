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

# Shared memory-pressure vocabulary (OK/BUSY/CRITICAL → colour + glyph + swap).
# RAM-used % from tmux-cpu was dropped: on macOS it reads ~90% when healthy
# (file cache), so it was learned-to-be-ignored noise. mem-lib reports the
# jetsam-relevant signal instead. See mem_segment below.
# Sourced relative to this script (not $HOME) so it resolves wherever the
# script lives — including the bats harness's isolated HOME.
# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=/dev/null
. "$SELF_DIR/mem-lib.sh"

cpu_percentage() {
	if [ -x "$cpu_script" ]; then
		"$cpu_script" 2>/dev/null | tr -d '\n'
	else
		printf "--%%"
	fi
}

# ram_percentage — the legacy RAM-used % from tmux-cpu, kept ALONGSIDE
# mem_segment as a transitional A/B so the two gauges can be compared in situ.
# Caveat: on macOS this over-reads (counts reclaimable inactive pages) and was
# the reason for the switch; trust mem_segment's swap/pressure signal over this.
# On Linux it is the meaningful indicator (mem_segment's macOS sysctls are
# absent there, so the gauge reads a flat OK). Drop this once the new gauge is
# trusted on macOS.
ram_percentage() {
	if [ -x "$ram_script" ]; then
		"$ram_script" 2>/dev/null | tr -d '\n'
	else
		printf "--%%"
	fi
}

# mem_segment — memory-pressure gauge in the powerline-pill shape. State is
# encoded by colour + glyph; bold escalates on BUSY/CRITICAL as the extra
# non-colour cue. The swap figure is always shown (OK included) so the resting
# baseline stays visible and calibrates the eye for when it climbs. Sysctl-only,
# cheap at the 15 s status-interval, so no caching.
mem_segment() {
	local state colour glyph
	state="$(mem_state)"
	colour="$(mem_state_colour "$state")"
	glyph="$(mem_state_glyph "$state")"
	if [ "$state" = "OK" ]; then
		printf "#[fg=#45475a]#[bg=#45475a]#[fg=#%s] %s %s " \
			"$colour" "$glyph" "$(mem_swap_human)"
	else
		printf "#[fg=#45475a]#[bg=#45475a]#[fg=#%s]#[bold] %s %s " \
			"$colour" "$glyph" "$(mem_swap_human)"
	fi
}

disk_percentage() {
	local disk
	# Query $HOME, not /: on macOS / is the sealed read-only System volume
	# (~12% used), while real files live on the Data volume. df resolves $HOME
	# to the right mount on both macOS and Linux without OS-specific branching.
	disk="$(df -h "$HOME" 2>/dev/null | awk 'NR==2 { print $5; exit }')"
	if [ -n "$disk" ]; then
		printf "%s" "$disk"
	else
		printf "-"
	fi
}

battery_percentage() {
	local pct="" status="" on_ac=0

	if command -v pmset >/dev/null 2>&1; then
		local batt
		batt="$(pmset -g batt 2>/dev/null || true)"
		printf '%s\n' "$batt" | grep -q 'InternalBattery' || return 0
		pct="$(printf '%s\n' "$batt" | grep -Eo '[0-9]{1,3}%' | head -n1 || true)"
		status="$(printf '%s\n' "$batt" | awk -F';' 'NR==2 { gsub(/^ +| +$/, "", $2); print $2 }')"
		# Line 1 ("Now drawing from 'AC Power'") is the authoritative power-source
		# signal, independent of charge motion: macOS holds near 100% on the adapter
		# without "charging", so the sub-state alone would hide that it is plugged.
		printf '%s\n' "$batt" | head -n1 | grep -q "'AC Power'" && on_ac=1
	elif [ -d /sys/class/power_supply ]; then
		local bat cap supply
		bat="$(find /sys/class/power_supply -maxdepth 1 -name 'BAT*' -type d 2>/dev/null | head -n1)"
		[ -n "$bat" ] || return 0
		cap="$(cat "$bat/capacity" 2>/dev/null || true)"
		[ -n "$cap" ] || return 0
		pct="${cap}%"
		status="$(cat "$bat/status" 2>/dev/null || true)"
		# Any Mains-type supply reporting online=1 means the adapter is attached
		# (covers AC/ACAD/ADP1 naming), mirroring the macOS power-source check.
		for supply in /sys/class/power_supply/*; do
			[ "$(cat "$supply/type" 2>/dev/null || true)" = "Mains" ] || continue
			[ "$(cat "$supply/online" 2>/dev/null || true)" = "1" ] || continue
			on_ac=1
			break
		done
	else
		return 0
	fi

	[ -n "$pct" ] || return 0
	if [ "$on_ac" = 1 ]; then
		# Plugged in: bolt while actively topping up, plug glyph while holding/full.
		case "$status" in
		[Cc]harging | *[Ff]inishing*) printf " %s" "$pct" ;;
		*) printf " %s" "$pct" ;;
		esac
	else
		printf " %s" "$pct"
	fi
}

iso_to_epoch() {
	local iso="$1"
	[ -n "$iso" ] || {
		echo 0
		return
	}
	local normalised
	normalised=$(printf '%s\n' "$iso" | sed -E 's/\.[0-9]+//; s/Z$/+0000/; s/([+-][0-9]{2}):([0-9]{2})$/\1\2/')
	date -d "$iso" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S%z" "$normalised" +%s 2>/dev/null || echo 0
}

git_branch_and_dirty() {
	local branch
	local dirty
	branch="-"
	dirty=""

	if [ -d "$pane_path" ] && cd "$pane_path" 2>/dev/null; then
		local -a git_cmd
		git_cmd=()

		if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
			git_cmd=(git)
		else
			local cwd_physical home_physical
			cwd_physical="$(pwd -P)"
			home_physical="$(cd "$HOME" 2>/dev/null && pwd -P || printf '%s' "$HOME")"
			if [ "$cwd_physical" = "$home_physical" ] && [ -d "$HOME/git/dotfiles" ]; then
				git_cmd=(git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME")
				if ! "${git_cmd[@]}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
					git_cmd=()
				fi
			fi
		fi

		if [ "${#git_cmd[@]}" -gt 0 ]; then
			branch="$("${git_cmd[@]}" rev-parse --abbrev-ref HEAD 2>/dev/null | cut -c1-15)"
			if [ -z "$branch" ]; then
				branch="-"
			fi
			if ! "${git_cmd[@]}" diff --quiet || ! "${git_cmd[@]}" diff --cached --quiet; then
				dirty="*"
			fi
			if [ -n "$("${git_cmd[@]}" ls-files --others --exclude-standard --directory --no-empty-directory 2>/dev/null | sed -n '1p')" ]; then
				dirty="${dirty}?"
			fi
		fi
	fi

	printf "%s%s" "$branch" "$dirty"
}

ssh_info() {
	local inbound=0 outbound=0
	if [ "$(uname)" = "Darwin" ]; then
		inbound="$(lsof -iTCP:22 -sTCP:ESTABLISHED -n -P 2>/dev/null | awk '$9 ~ /:22->/' | wc -l | tr -d ' ')"
		outbound="$(lsof -iTCP:22 -sTCP:ESTABLISHED -n -P 2>/dev/null | awk '$9 ~ /->.*:22$/' | wc -l | tr -d ' ')"
	else
		inbound="$(ss -tn state established '( sport = :22 )' 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
		outbound="$(ss -tn state established '( dport = :22 )' 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
	fi

	[ "${inbound:-0}" -eq 0 ] 2>/dev/null && [ "${outbound:-0}" -eq 0 ] 2>/dev/null && return

	local label=""
	[ "$inbound" -gt 0 ] 2>/dev/null && label="${inbound}↓"
	[ "$outbound" -gt 0 ] 2>/dev/null && label="${label}${outbound}↑"

	local agent=""
	if SSH_AUTH_SOCK="$HOME/.ssh/agent.sock" timeout 1 ssh-add -l >/dev/null 2>&1; then
		agent="#[fg=#a6e3a1]🔑"
	fi

	printf "#[fg=#3b2a30]#[bg=#3b2a30]#[fg=#fab387] %s%s " "$label" "$agent"
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
	local ttl=300 trigger_ttl=60 lock_stale_after=600 now bin="$HOME/.local/bin"
	now=$(date +%s)

	_mtime() {
		local file="$1"
		stat -c '%Y' "$file" 2>/dev/null || stat -f%m "$file" 2>/dev/null || echo 0
	}

	_claude_auth_expires_at() {
		local credentials_json=""
		if [[ "${OSTYPE:-}" == darwin* ]] && command -v security >/dev/null 2>&1; then
			credentials_json=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
		fi
		if [ -z "$credentials_json" ] && [ -f "$HOME/.claude/.credentials.json" ]; then
			credentials_json=$(cat "$HOME/.claude/.credentials.json" 2>/dev/null || true)
		fi
		printf '%s' "$credentials_json" | jq -r '.claudeAiOauth.expiresAt // empty' 2>/dev/null || true
	}

	_should_trigger_refresh() {
		local cache="$1"
		local meta="$2"
		local lockdir="$3"
		local trigger="$4"
		local provider="${5:-}"
		local next_retry trigger_age cache_age cache_mtime trigger_mtime

		if [ -f "$cache" ]; then
			cache_mtime=$(_mtime "$cache")
			cache_age=$((now - cache_mtime))
			[ "$cache_age" -lt "$ttl" ] && return 1
		fi

		next_retry=$(jq -r '.next_retry_at // 0' "$meta" 2>/dev/null || echo 0)
		if [ "$provider" = "claude" ] && [ -f "$meta" ]; then
			local last_error last_http_status saved_auth_expires_at current_auth_expires_at
			last_error=$(jq -r '.last_error // ""' "$meta" 2>/dev/null || echo "")
			last_http_status=$(jq -r '.last_http_status // ""' "$meta" 2>/dev/null || echo "")
			saved_auth_expires_at=$(jq -r '.auth_expires_at // empty' "$meta" 2>/dev/null || echo "")
			if [ "$last_error" = "auth_expired" ] || [ "$last_http_status" = "401" ]; then
				current_auth_expires_at=$(_claude_auth_expires_at)
				if [ -z "$current_auth_expires_at" ] || { [ -n "$saved_auth_expires_at" ] && [ "$current_auth_expires_at" = "$saved_auth_expires_at" ]; }; then
					return 1
				fi
				next_retry=0
			fi
		fi
		[ "$now" -lt "$next_retry" ] && return 1

		if [ -d "$lockdir" ]; then
			local lock_pid="-" lock_started="" lock_age=0
			[ -f "$lockdir/pid" ] && lock_pid="$(cat "$lockdir/pid" 2>/dev/null || echo -)"
			[ -f "$lockdir/started_at" ] && lock_started="$(cat "$lockdir/started_at" 2>/dev/null || echo)"
			if [[ "$lock_started" =~ ^[0-9]+$ ]]; then
				lock_age=$((now - lock_started))
			else
				lock_age=$((now - $(_mtime "$lockdir")))
			fi
			if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null && [ "$lock_age" -lt "$lock_stale_after" ]; then
				return 1
			fi
			rm -f "$lockdir/pid" "$lockdir/started_at" 2>/dev/null
			rmdir "$lockdir" 2>/dev/null || return 1
		fi

		if [ -f "$trigger" ]; then
			trigger_mtime=$(_mtime "$trigger")
			trigger_age=$((now - trigger_mtime))
			[ "$trigger_age" -lt "$trigger_ttl" ] && return 1
		fi

		return 0
	}

	if [ -x "$bin/claude-usage" ] && _should_trigger_refresh "$claude_cache" "$claude_meta" "$claude_lock" "$claude_trigger" "claude"; then
		mkdir -p "$(dirname "$claude_trigger")"
		: >"$claude_trigger"
		"$bin/claude-usage" >/dev/null 2>&1 &
	fi

	if [ -x "$bin/codex-usage" ] && _should_trigger_refresh "$codex_cache" "$codex_meta" "$codex_lock" "$codex_trigger" "codex"; then
		mkdir -p "$(dirname "$codex_trigger")"
		: >"$codex_trigger"
		"$bin/codex-usage" >/dev/null 2>&1 &
	fi

	# Read percentages and remaining seconds from cache
	local claude_5_pct="" claude_7_pct="" codex_5_pct="" codex_7_pct=""
	local claude_5_remaining_secs="" claude_7_remaining_secs=""
	local codex_5_remaining_secs="" codex_7_remaining_secs=""
	local claude_5_reset="" claude_7_reset="" codex_5_reset="" codex_7_reset=""
	local claude_cache_age=999999 codex_cache_age=999999
	local claude_5_stale=0 claude_7_stale=0 codex_5_stale=0 codex_7_stale=0

	_fmt_reset() {
		local remaining_secs="$1"
		local cache_age="$2"
		if [ -z "$remaining_secs" ]; then
			return 0
		fi
		if [ "$remaining_secs" -le 0 ] 2>/dev/null; then
			if [ "$cache_age" -ge "$ttl" ] 2>/dev/null; then
				printf "stale"
			else
				printf "0m"
			fi
		elif [ "$remaining_secs" -ge 86400 ]; then
			printf "%dd" "$((remaining_secs / 86400))"
		elif [ "$remaining_secs" -ge 3600 ]; then
			printf "%dh" "$(((remaining_secs + 1800) / 3600))"
		else
			printf "%dm" "$((remaining_secs / 60))"
		fi
	}

	_iso_remaining_secs() {
		local resets_at="$1"
		[ -n "$resets_at" ] || return 0
		local reset_ts
		reset_ts=$(iso_to_epoch "$resets_at")
		[ "$reset_ts" -gt 0 ] 2>/dev/null || return 0
		local remaining=$((reset_ts - now))
		[ "$remaining" -lt 0 ] && remaining=0
		printf "%s" "$remaining"
	}

	_relative_remaining_secs() {
		local reset_secs="$1"
		local cache_file="$2"
		[ -n "$reset_secs" ] || return 0
		[[ "$reset_secs" =~ ^[0-9]+$ ]] || return 0
		local cache_mt remaining
		cache_mt=$(_mtime "$cache_file")
		remaining=$((reset_secs - (now - cache_mt)))
		[ "$remaining" -lt 0 ] && remaining=0
		printf "%s" "$remaining"
	}

	if [ -f "$claude_cache" ]; then
		claude_cache_age=$((now - $(_mtime "$claude_cache")))
		claude_5_pct=$(jq -r '.five_hour.utilization // empty' "$claude_cache" 2>/dev/null)
		claude_7_pct=$(jq -r '.seven_day.utilization // empty' "$claude_cache" 2>/dev/null)
		local claude_5_resets_at claude_7_resets_at
		claude_5_resets_at=$(jq -r '.five_hour.resets_at // empty' "$claude_cache" 2>/dev/null)
		claude_7_resets_at=$(jq -r '.seven_day.resets_at // empty' "$claude_cache" 2>/dev/null)
		claude_5_remaining_secs=$(_iso_remaining_secs "$claude_5_resets_at")
		claude_7_remaining_secs=$(_iso_remaining_secs "$claude_7_resets_at")
		claude_5_reset=$(_fmt_reset "$claude_5_remaining_secs" "$claude_cache_age")
		claude_7_reset=$(_fmt_reset "$claude_7_remaining_secs" "$claude_cache_age")
		[ "$claude_5_reset" = "stale" ] 2>/dev/null && claude_5_stale=1
		[ "$claude_7_reset" = "stale" ] 2>/dev/null && claude_7_stale=1
	fi

	if [ -f "$codex_cache" ]; then
		codex_cache_age=$((now - $(_mtime "$codex_cache")))
		codex_5_pct=$(jq -r '.rate_limit.primary_window.used_percent // empty' "$codex_cache" 2>/dev/null)
		codex_7_pct=$(jq -r '.rate_limit.secondary_window.used_percent // empty' "$codex_cache" 2>/dev/null)
		local codex_5_reset_secs codex_7_reset_secs
		codex_5_reset_secs=$(jq -r '.rate_limit.primary_window.reset_after_seconds // empty' "$codex_cache" 2>/dev/null)
		codex_7_reset_secs=$(jq -r '.rate_limit.secondary_window.reset_after_seconds // empty' "$codex_cache" 2>/dev/null)
		codex_5_remaining_secs=$(_relative_remaining_secs "$codex_5_reset_secs" "$codex_cache")
		codex_7_remaining_secs=$(_relative_remaining_secs "$codex_7_reset_secs" "$codex_cache")
		codex_5_reset=$(_fmt_reset "$codex_5_remaining_secs" "$codex_cache_age")
		codex_7_reset=$(_fmt_reset "$codex_7_remaining_secs" "$codex_cache_age")
		[ "$codex_5_reset" = "stale" ] 2>/dev/null && codex_5_stale=1
		[ "$codex_7_reset" = "stale" ] 2>/dev/null && codex_7_stale=1
	fi

	[ -z "$claude_5_pct" ] && [ -z "$codex_5_pct" ] && return

	# Pace-based colour: compare usage% against elapsed% of the matching window
	# pace = usage% / elapsed%, green <1.2, yellow 1.2-1.4, red >=1.4
	_usage_colour() {
		local usage_pct=$1 remaining_secs=$2 window_secs=$3
		local usage_int=${usage_pct%.*}
		usage_int=${usage_int:-0}

		# No usage → green
		if [ "$usage_int" -le 0 ] 2>/dev/null; then
			echo "a6e3a1"
			return
		fi

		local elapsed_secs=$((window_secs - remaining_secs))
		# Early window (<3min elapsed) → green (pace too unstable)
		if [ "$elapsed_secs" -lt 180 ]; then
			echo "a6e3a1"
			return
		fi

		local elapsed_pct=$((elapsed_secs * 100 / window_secs))
		[ "$elapsed_pct" -le 0 ] && elapsed_pct=1

		local pace_x100=$((usage_int * 100 / elapsed_pct))
		if [ "$pace_x100" -ge 140 ]; then
			echo "f38ba8"
		elif [ "$pace_x100" -ge 120 ]; then
			echo "f9e2af"
		else echo "a6e3a1"; fi
	}

	# overlay2 (not overlay1 #7f849c): on the #232334 AI pill overlay1 is only
	# 4.17:1 — below WCAG AA — and this "dim" run still carries readable info
	# (reset times, % signs). overlay2 lifts it to 5.46:1 while staying clearly
	# subordinate to the bright usage numbers.
	local dim="#9399b2"
	local show_weekly=0 show_weekly_resets=0
	[ "$width_raw" -ge 100 ] && show_weekly=1
	[ "$width_raw" -ge 100 ] && show_weekly_resets=1

	_provider_colour() {
		local stale="$1"
		local pct="$2"
		local remaining="$3"
		local window_secs="$4"
		if [ "$stale" -eq 1 ]; then
			printf "%s" "${dim#"#"}"
		else
			_usage_colour "$pct" "${remaining:-$window_secs}" "$window_secs"
		fi
	}

	_append_provider() {
		local label="$1"
		local pct5="$2"
		local pct7="$3"
		local reset5="$4"
		local reset7="$5"
		local remaining5="$6"
		local remaining7="$7"
		local stale5="$8"
		local stale7="$9"
		local label_colour="${10}"

		[ -n "$pct5" ] || return 0

		if [ "$appended_provider" -eq 1 ]; then
			out+=" #[fg=${dim}]│"
		fi
		appended_provider=1

		local c5 c7 i5 i7
		c5=$(_provider_colour "$stale5" "$pct5" "$remaining5" 18000)
		i5=$(printf "%.0f" "$pct5" 2>/dev/null || echo "$pct5")

		out+=" #[fg=${label_colour}]#[bold]${label}#[nobold]#[fg=${dim}]:#[fg=#${c5}]${i5}#[fg=${dim}]%"
		[ -n "$reset5" ] && out+="#[fg=${dim}]·${reset5}"
		if [ "$show_weekly" -eq 1 ] && [ -n "$pct7" ]; then
			c7=$(_provider_colour "$stale7" "$pct7" "$remaining7" 604800)
			i7=$(printf "%.0f" "$pct7" 2>/dev/null || echo "$pct7")
			out+="#[fg=${dim}] #[fg=#${c7}]${i7}#[fg=${dim}]%"
			[ "$show_weekly_resets" -eq 1 ] && [ -n "$reset7" ] && out+="#[fg=${dim}]·${reset7}"
		fi
		return 0
	}

	# Build segment: powerline separator then colour-coded labels
	local out="#[fg=#232334]#[bg=#232334]"
	local appended_provider=0

	_append_provider "C" "$claude_5_pct" "$claude_7_pct" "$claude_5_reset" "$claude_7_reset" "$claude_5_remaining_secs" "$claude_7_remaining_secs" "$claude_5_stale" "$claude_7_stale" "#fab387"
	_append_provider "X" "$codex_5_pct" "$codex_7_pct" "$codex_5_reset" "$codex_7_reset" "$codex_5_remaining_secs" "$codex_7_remaining_secs" "$codex_5_stale" "$codex_7_stale" "#74c7ec"
	out+=" "

	printf "%s" "$out"
}

print_full() {
	local cpu ram disk battery git_ref host
	cpu="$(cpu_percentage)"
	ram="$(ram_percentage)"
	disk="$(disk_percentage)"
	battery="$(battery_percentage || true)"
	git_ref="$(git_branch_and_dirty)"
	host="$(host_label)"

	ai_usage
	printf "#[fg=#313244]#[bg=#313244]#[fg=#f38ba8]#[bold]  %s " "$cpu"
	mem_segment
	# Legacy RAM% pill (A/B against mem_segment). Dark pill with mauve content, in
	# the data-pill family (cpu/disk/git) — not a bright accent pill. Its own dark
	# shade (#313244, cpu's; separated from cpu by the pressure pill) keeps it a
	# distinct segment instead of merging into the pressure pill's #45475a.
	printf "#[fg=#313244]#[bg=#313244]#[fg=#cba6f7]#[bold] 󰘚 %s " "$ram"
	# Disk + git pills sit on surface1 (#45475a), not the lighter surface2/overlay0
	# they used to: coloured text needs surface0/surface1 to clear WCAG AA (peach on
	# surface2 is 3.8:1, green on overlay0 3.3:1 — both fail). They don't merge —
	# disk/git are non-adjacent, separated by the bright battery/host pills, and the
	# fg colour + icon distinguish them, not the pill shade.
	printf "#[fg=#45475a]#[bg=#45475a]#[fg=#fab387]#[bold] 󰋊 %s " "$disk"
	[ -n "$battery" ] && printf "#[fg=#74c7ec]#[bg=#74c7ec]#[fg=#1e1e2e]#[bold] %s " "$battery"
	printf "#[fg=#45475a]#[bg=#45475a]#[fg=#a6e3a1]  %s " "$git_ref"
	ssh_info
	printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold]  %s" "$host"
}

print_medium() {
	local git_ref host
	git_ref="$(git_branch_and_dirty)"
	host="$(host_label)"

	printf "#[fg=#45475a]#[bg=#45475a]#[fg=#a6e3a1]  %s " "$git_ref"
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

if [ "$width_raw" -ge 80 ]; then
	print_full
elif [ "$width_raw" -ge 45 ]; then
	print_medium
elif [ "$width_raw" -ge 35 ]; then
	print_compact
fi
# < 35: output nothing except reboot indicator (clock-only from tmux.conf)
