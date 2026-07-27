#!/usr/bin/env bash

# --- bash5 re-exec preamble: keep 3.2-parseable, keep above `set -u` ---
# macOS ships bash 3.2 at /bin/bash and tmux hands it to run-shell. Re-exec under
# the nix bash 5 that is already installed but ordered behind /bin in PATH.
if [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	if [ -n "${TMUX_BASH5_REEXEC:-}" ]; then
		printf '%s: re-exec did not yield bash >= 5 (got %s)\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
		exit 127
	fi
	for _b5 in "/etc/profiles/per-user/${USER:-$LOGNAME}/bin/bash" \
		/run/current-system/sw/bin/bash "$HOME/.nix-profile/bin/bash" \
		/nix/var/nix/profiles/default/bin/bash /opt/homebrew/bin/bash; do
		if [ -x "$_b5" ]; then
			TMUX_BASH5_REEXEC=1
			export TMUX_BASH5_REEXEC
			exec "$_b5" "$0" ${1+"$@"}
		fi
	done
	printf '%s: requires bash >= 5, found %s\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
	exit 127
fi
# Never inherited: each script guards itself, so a bash-5 parent must not
# suppress a 3.2 child's own re-exec.
unset TMUX_BASH5_REEXEC _b5
# --- end bash5 preamble ---

set -eu

width_raw="${1:-0}"
pane_path="${2:-$HOME}"
host_short="${3:-}"
host_full="${4:-}"
hostname_full_flag="${5:-}"
attached_session="${6:-}"

if ! [[ "$width_raw" =~ ^[0-9]+$ ]]; then
	width_raw=0
fi

cpu_script="$HOME/.config/tmux/plugins/tmux-cpu/scripts/cpu_percentage.sh"
ram_script="$HOME/.config/tmux/plugins/tmux-cpu/scripts/ram_percentage.sh"

# Shared memory-pressure vocabulary (OK/BUSY/CRITICAL → colour + glyph +
# swap-figure, or a ▲ marker in the figure slot when kernel pressure is the cause).
# RAM-used % from tmux-cpu was dropped: on macOS it reads ~90% when healthy
# (file cache), so it was learned-to-be-ignored noise. mem-lib reports the
# jetsam-relevant signal instead. See mem_segment below.
# Sourced relative to this script (not $HOME) so it resolves wherever the
# script lives — including the bats harness's isolated HOME.
# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=/dev/null
. "$SELF_DIR/mem-lib.sh"
# Shared resurrect-freshness vocabulary (FRESH/AGING/STALE/NONE → colour + glyph
# + age token). Reads the newest save file's mtime each render — cheap, no
# caching — so a live green "saved 2m" is visible confidence that saving works,
# reddening to yellow/red the moment it stops. See resurrect_segment below.
# shellcheck source=/dev/null
. "$SELF_DIR/resurrect-lib.sh"
# Shared keep-awake vocabulary (ON/OFF → colour + glyph + ∞/remaining token).
# Reads the caffeinate pidfile; OFF → the pill self-hides. See caffeine_segment.
# shellcheck source=/dev/null
. "$SELF_DIR/caffeine-lib.sh"
# Canonical agent-state helpers: other_sessions_badge (the cross-session
# attention rollup) plus the agent_hex/agent_char glyph mapping it echoes. See
# agent_elsewhere_segment below.
# shellcheck source=/dev/null
. "$SELF_DIR/agent-state-lib.sh"

# cpu_percentage — serve the last sample immediately and refresh stale data in
# the background. The tmux-cpu sampler blocks for ~1s; it must never hold up a
# pane navigation or status render.
cpu_percentage() {
	local cache="$HOME/.cache/tmux-cpu-percentage" lock="${HOME}/.cache/tmux-cpu-percentage.lock"
	local ttl=15 now mtime age stale="--%"
	now=$(date +%s)
	if [ -f "$cache" ]; then
		stale=$(cat "$cache")
		mtime=$(stat -c '%Y' "$cache" 2>/dev/null || stat -f%m "$cache" 2>/dev/null || echo 0)
		age=$((now - mtime))
		if [ "$age" -lt "$ttl" ] 2>/dev/null; then
			printf '%s' "$stale"
			return
		fi
	fi

	mkdir -p "$(dirname "$cache")"
	if ! mkdir "$lock" 2>/dev/null; then
		mtime=$(stat -c '%Y' "$lock" 2>/dev/null || stat -f%m "$lock" 2>/dev/null || echo "$now")
		age=$((now - mtime))
		if [ "$age" -gt 10 ] 2>/dev/null; then
			rmdir "$lock" 2>/dev/null || true
			mkdir "$lock" 2>/dev/null || {
				printf '%s' "$stale"
				return
			}
		else
			printf '%s' "$stale"
			return
		fi
	fi

	if [ -x "$cpu_script" ]; then
		(
			trap 'rmdir "$lock" 2>/dev/null || true' EXIT INT TERM
			value=$(timeout 5 "$cpu_script" 2>/dev/null | tr -d '\n') || value=""
			if [ -n "$value" ]; then
				printf '%s' "$value" >"${cache}.tmp.$$" && mv -f "${cache}.tmp.$$" "$cache"
			fi
			rmdir "$lock" 2>/dev/null || true
			trap - EXIT
		) </dev/null >/dev/null 2>&1 &
	else
		rmdir "$lock" 2>/dev/null || true
	fi
	printf '%s' "$stale"
}

# ram_percentage — RAM-used % from tmux-cpu, shown ALONGSIDE mem_segment by
# design: the two measure different things and both are wanted. ram% is the
# total-used headline; mem_segment is the jetsam-relevant swap/pressure signal.
# Caveat: on macOS ram% over-reads (counts reclaimable inactive pages), so read
# it as a rough ceiling and trust mem_segment for actual pressure. On Linux
# mem_segment's sysctls are absent (flat OK), so ram% is the meaningful gauge.
ram_percentage() {
	if command -v vm_stat >/dev/null 2>&1; then
		vm_stat 2>/dev/null | awk '
			/Pages active:/ { active=$NF }
			/Pages inactive:/ { inactive=$NF }
			/Pages speculative:/ { speculative=$NF }
			/Pages wired down:/ { wired=$NF }
			/Pages occupied by compressor:/ { compressor=$NF }
			/Pages purgeable:/ { purgeable=$NF }
			/File-backed pages:/ { filebacked=$NF }
			/Pages free:/ { free=$NF }
			END {
				used_cached=active+inactive+speculative+wired+compressor
				used=used_cached-purgeable-filebacked
				total=used_cached+free
				if (total > 0) printf "%.0f%%", 100*used/total
			}'
	elif [ -x "$ram_script" ]; then
		"$ram_script" 2>/dev/null | tr -d '\n'
	else
		printf "--%%"
	fi
}

# mem_segment — memory-pressure gauge in the powerline-pill shape. State is
# encoded by colour + glyph; bold escalates on BUSY/CRITICAL as the extra
# non-colour cue. The figure slot shows the swap figure (OK included, so the
# resting baseline stays visible and calibrates the eye), except when kernel
# pressure is the cause — there a ▲ marker takes the slot (swap is fine, look
# elsewhere). See mem_token. Sysctl-only, cheap at the 15 s status-interval, so
# no caching.
mem_segment() {
	local reading pressure swap_raw swap state colour glyph token
	reading="$(sysctl -n kern.memorystatus_vm_pressure_level vm.swapusage 2>/dev/null || true)"
	pressure="${reading%%$'\n'*}"
	case "$pressure" in 1 | 2 | 4) ;; *) pressure=1 ;; esac
	if [[ "$reading" == *$'\n'* ]]; then
		swap_raw="${reading#*$'\n'}"
	else
		swap_raw=""
	fi
	swap="$(mem_swap_used_mb_from "$swap_raw")"
	IFS=$'\t' read -r state colour glyph token <<<"$(mem_attrs_from "$pressure" "$swap")"
	if [ "$state" = "OK" ]; then
		printf "#[range=user|mem]#[fg=#45475a]#[bg=#45475a]#[fg=#%s] %s %s #[norange]" \
			"$colour" "$glyph" "$token"
	else
		printf "#[range=user|mem]#[fg=#45475a]#[bg=#45475a]#[fg=#%s]#[bold] %s %s #[norange]" \
			"$colour" "$glyph" "$token"
	fi
}

# resurrect_segment — session-save freshness gauge in the powerline-pill shape,
# parallel to mem_segment. State is encoded by colour (green FRESH / yellow AGING
# / red STALE+NONE) plus glyph (⟳ turning / ⚠ wrong) plus the age token; bold
# escalates on any non-FRESH state as the extra non-colour cue. Always shown: a
# live green "⟳ 2m" is the running-confidence signal the 3.5-week silent-save
# incident lacked. Reads one file mtime per 15 s render — cheap, no caching.
# Cross-platform: Linux hosts (continuum-driven) get the same detect pill.
resurrect_segment() {
	local age state colour glyph token
	age="$(resurrect_newest_age_secs)"
	IFS=$'\t' read -r state colour glyph token <<<"$(resurrect_attrs_from "$age")"
	if [ "$state" = "FRESH" ]; then
		printf "#[fg=#45475a]#[bg=#45475a]#[fg=#%s] %s %s " \
			"$colour" "$glyph" "$token"
	else
		printf "#[fg=#45475a]#[bg=#45475a]#[fg=#%s]#[bold] %s %s " \
			"$colour" "$glyph" "$token"
	fi
}

# caffeine_segment — keep-awake indicator, self-hiding: OFF prints nothing (like
# agent_elsewhere_segment), so an idle Mac shows no pill. ON is a bright peach
# accent pill (dark text on #fab387, the reboot/battery bright-pill idiom) so an
# active caffeinate is never silently left running — the surface1-adjacency
# caveat the resurrect pill raises doesn't apply to a bright accent bg. Token is
# ∞ (indefinite) or the remaining time (ticks down to the self-clearing deadline).
caffeine_segment() {
	local state colour glyph
	state="$(caffeine_state)"
	[ "$state" = "OFF" ] && return 0
	colour="$(caffeine_state_colour "$state")"
	glyph="$(caffeine_state_glyph "$state")"
	printf "#[fg=#%s]#[bg=#%s]#[fg=#1e1e2e]#[bold] %s %s " \
		"$colour" "$colour" "$glyph" "$(caffeine_token)"
}

# agent_elsewhere_segment — the cross-session attention badge: a bright pill
# showing the worst attention state's glyph + a count of blocked/done agent panes
# living in *other* sessions (exactly what prefix + A / Alt+a would jump to). It
# restores the ambient "agents need you elsewhere" signal that the per-attached-
# session tab dots lose the moment work spreads across sessions. Self-hides when
# nothing is elsewhere (early return, like ssh_info) and when disabled via
# `@cross_session_badge off` (handled in other_sessions_badge). Placed leftmost in
# the right-aligned cluster so it sits toward screen-centre where it catches the eye.
agent_elsewhere_segment() {
	local badge hex char count
	badge="$(other_sessions_badge "$attached_session")"
	[ -n "$badge" ] || return 0
	read -r hex char count <<<"$badge"
	printf "#[range=user|agents]#[fg=#313244]#[bg=#313244]#[fg=#%s]#[bold] %s%s #[norange]" "$hex" "$char" "$count"
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

# git_branch_and_dirty — cached wrapper: the raw probe below costs 4 git forks
# (rev-parse + 2x diff + ls-files) and re-ran on every render, including every
# pane switch via the refresh-client hooks. Same mtime/TTL idiom as
# cpu_percentage, keyed per pane path (cksum of the cwd in the filename) so
# panes in different repos never share an entry. Worst case is a ~15s-stale
# branch/dirty marker.
git_branch_and_dirty() {
	local cache ttl=15 now mtime age value
	cache="$HOME/.cache/tmux-git-branch-$(printf '%s' "$pane_path" | cksum | tr ' ' '-')"
	now=$(date +%s)
	if [ -f "$cache" ]; then
		mtime=$(stat -c '%Y' "$cache" 2>/dev/null || stat -f%m "$cache" 2>/dev/null || echo 0)
		age=$((now - mtime))
		if [ "$age" -lt "$ttl" ] 2>/dev/null; then
			cat "$cache"
			return
		fi
	fi
	value="$(compute_git_branch_and_dirty)"
	mkdir -p "$(dirname "$cache")"
	printf "%s" "$value" >"${cache}.tmp.$$" && mv -f "${cache}.tmp.$$" "$cache"
	printf "%s" "$value"
}

compute_git_branch_and_dirty() {
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
		# One lsof capture and one parser: lsof walks every open TCP socket, so
		# avoid querying or scanning the result once per direction.
		local conns
		conns="$(lsof -iTCP:22 -sTCP:ESTABLISHED -n -P 2>/dev/null || true)"
		read -r inbound outbound <<<"$(awk '
			$9 ~ /:22->/ { inbound++ }
			$9 ~ /->.*:22$/ { outbound++ }
			END { print inbound + 0, outbound + 0 }' <<<"$conns")"
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
	if [ -n "$hostname_full_flag" ]; then
		printf "%s" "$host_full"
		return
	fi
	# Show the last 8 chars; the distinctive part of these hostnames is the tail
	# (the shared prefix is noise). Shorter hosts print whole.
	local len=${#host_short}
	if [ "$len" -gt 8 ]; then
		printf "%s" "${host_short:len-8}"
	else
		printf "%s" "$host_short"
	fi
}

print_full() {
	local cpu ram disk battery git_ref host
	cpu="$(cpu_percentage)"
	ram="$(ram_percentage)"
	disk="$(disk_percentage)"
	battery="$(battery_percentage || true)"
	git_ref="$(git_branch_and_dirty)"
	host="$(host_label)"

	agent_elsewhere_segment
	# Resurrect freshness is the first persistent system pill. Its surface1
	# (#45475a) shade stays distinct from the following CPU pill (#313244).
	# Width-gated with the rest of print_full (>= 80).
	resurrect_segment
	# Keep-awake pill sits with the other custom-lib pills. Self-hiding, so it
	# adds nothing while off; a bright peach accent when on.
	caffeine_segment
	printf "#[fg=#313244]#[bg=#313244]#[fg=#f38ba8]#[bold]  %s " "$cpu"
	mem_segment
	# RAM% pill (shown alongside mem_segment by design — both wanted). Dark pill
	# with mauve content, in the data-pill family (cpu/disk/git) — not a bright
	# accent pill. Its own dark shade (#313244, cpu's; separated from cpu by the
	# pressure pill) keeps it a distinct segment instead of merging into the
	# pressure pill's #45475a.
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
	printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold] %s" "$host"
}

print_medium() {
	local git_ref host
	git_ref="$(git_branch_and_dirty)"
	host="$(host_label)"

	agent_elsewhere_segment
	printf "#[fg=#45475a]#[bg=#45475a]#[fg=#a6e3a1]  %s " "$git_ref"
	ssh_info
	printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold] %s" "$host"
}

print_compact() {
	local host
	host="$(host_label)"
	ssh_info
	printf "#[fg=#89b4fa]#[bg=#89b4fa]#[fg=#1e1e2e]#[bold] %s" "$host"
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
