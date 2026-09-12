#!/usr/bin/env bash
# agent-autohibernate.sh: pressure-gated policy, pins, status, and auto commit.
# --- bash5 re-exec preamble: keep 3.2-parseable, keep above `set -u` ---
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
unset TMUX_BASH5_REEXEC _b5
# --- end bash5 preamble ---

set -uo pipefail

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENGINE=${AGENT_AUTO_ENGINE:-$SELF_DIR/agent-hibernate.sh}
STATE_DIR=${AGENT_AUTO_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-autohibernate}
PINS_FILE=${AGENT_AUTO_PINS_FILE:-$STATE_DIR/pins.json}
POLICY_FILE=${AGENT_AUTO_POLICY_FILE:-$STATE_DIR/policy.json}
EVENTS_FILE=${AGENT_AUTO_EVENTS_FILE:-$STATE_DIR/events.jsonl}
MIN_IDLE=${AGENT_AUTO_MIN_IDLE:-86400}
COOLDOWN=${AGENT_AUTO_COOLDOWN:-900}
CRITICAL_SAMPLES=${AGENT_AUTO_CRITICAL_SAMPLES:-3}
SUSTAINED_FOR=${AGENT_AUTO_SUSTAINED_FOR:-20}
EPISODE_CAP=${AGENT_AUTO_EPISODE_CAP:-2}
RESET_AFTER=${AGENT_AUTO_RESET_AFTER:-300}
TICK_LOCK=""

cleanup_tick_lock() {
	[ -n "$TICK_LOCK" ] && rmdir "$TICK_LOCK" 2>/dev/null || true
}
trap cleanup_tick_lock EXIT

# shellcheck source=agent-state-lib.sh disable=SC1091
. "$SELF_DIR/agent-state-lib.sh"
# shellcheck source=mem-lib.sh disable=SC1091
. "$SELF_DIR/mem-lib.sh"

die() {
	printf 'agent auto: %s\n' "$2" >&2
	exit "$1"
}

for _setting in "$MIN_IDLE" "$COOLDOWN" "$CRITICAL_SAMPLES" "$SUSTAINED_FOR" "$EPISODE_CAP" "$RESET_AFTER"; do
	case $_setting in '' | *[!0-9]*) die 2 'policy settings must be non-negative integers' ;; esac
done
[ "$CRITICAL_SAMPLES" -ge 1 ] && [ "$EPISODE_CAP" -ge 1 ] || die 2 'sample count and episode cap must be positive'
unset _setting

mode() {
	local value
	value=$(tmux show-options -gqv @agent_auto_hibernate 2>/dev/null) || value=
	case "$value" in off | observe | on) printf '%s\n' "$value" ;; *) printf 'observe\n' ;; esac
}

pin_revision() {
	[ -f "$PINS_FILE" ] || {
		printf 'none\n'
		return
	}
	cksum "$PINS_FILE" 2>/dev/null | awk '{ print $1 ":" $2 }'
}

pins_json() {
	if [ ! -f "$PINS_FILE" ]; then
		printf '{}\n'
		return
	fi
	jq -ec 'select(type == "object" and all(to_entries[]; .value == true))' "$PINS_FILE" 2>/dev/null || return 1
}

write_pins() {
	local json=$1 tmp="$PINS_FILE.tmp.$$"
	mkdir -p "$STATE_DIR"
	printf '%s\n' "$json" >"$tmp"
	chmod 600 "$tmp"
	mv -f "$tmp" "$PINS_FILE"
}

probe() {
	"$ENGINE" probe "$1"
}

pin_key_for() {
	probe "$1" | jq -er '.kind + ":" + .sessionId'
}

sync_pin_mirror() {
	local pane=$1 pins=$2 key
	if key=$(pin_key_for "$pane" 2>/dev/null) && jq -e --arg key "$key" '.[$key] == true' <<<"$pins" >/dev/null; then
		tmux set-option -p -t "$pane" @agent_hibernate_pinned on 2>/dev/null || true
		return 0
	fi
	tmux set-option -pu -t "$pane" @agent_hibernate_pinned 2>/dev/null || true
	return 1
}

cmd_pin() {
	local pane=${1:-} pins key
	[ -n "$pane" ] || die 2 'pin needs a pane'
	command -v jq >/dev/null 2>&1 || die 1 'jq required'
	pins=$(pins_json) || die 1 'pin store is malformed'
	key=$(pin_key_for "$pane") || die 6 'pane has no exact resumable session'
	write_pins "$(jq -c --arg key "$key" '.[$key] = true' <<<"$pins")"
	tmux set-option -p -t "$pane" @agent_hibernate_pinned on 2>/dev/null || true
	printf 'pinned %s\n' "$key"
}

cmd_unpin() {
	local pane=${1:-} pins key
	[ -n "$pane" ] || die 2 'unpin needs a pane'
	pins=$(pins_json) || die 1 'pin store is malformed'
	key=$(pin_key_for "$pane") || die 6 'pane has no exact resumable session'
	write_pins "$(jq -c --arg key "$key" 'del(.[$key])' <<<"$pins")"
	tmux set-option -pu -t "$pane" @agent_hibernate_pinned 2>/dev/null || true
	printf 'unpinned %s\n' "$key"
}

pane_rows() {
	tmux list-panes -a -F $'#{pane_id}\t#{@agent_state}\t#{@agent_kind}\t#{@agent_idle_since}\t#{pane_active}\t#{window_active}\t#{session_attached}' 2>/dev/null
}

# gather_candidates NOW PINS - emit one TSV row per pane:
# pane, decision, idleSince, kind, sessionId, pid, pinRevision.
gather_candidates() {
	local now=$1 pins=$2 pane state kind since pa wa sa key data sid pid reason
	local -A seen=() visible=()
	local -A states=() kinds=() sinces=()
	while IFS=$'\t' read -r pane state kind since pa wa sa; do
		[ -n "$pane" ] || continue
		seen[$pane]=1
		states[$pane]=$state
		kinds[$pane]=$kind
		sinces[$pane]=$since
		if is_viewing "${pa:-0}" "${wa:-0}" "${sa:-0}"; then visible[$pane]=1; fi
	done < <(pane_rows)
	for pane in "${!seen[@]}"; do
		state=${states[$pane]}
		kind=${kinds[$pane]}
		since=${sinces[$pane]}
		reason=
		case "$kind" in claude | codex) ;; *) reason=unsupported-kind ;; esac
		[ -n "$reason" ] || [ "$state" = idle ] || reason="state-${state:-unknown}"
		[ -n "$reason" ] || [ -z "${visible[$pane]:-}" ] || reason=visible
		if [ -z "$reason" ]; then
			case "$since" in '' | *[!0-9]*) reason=idle-age-unknown ;;
			*) [ "$since" -le "$now" ] 2>/dev/null && [ $((now - since)) -ge "$MIN_IDLE" ] || reason=too-young ;;
			esac
		fi
		data="" sid="" pid="" key=""
		if [ -z "$reason" ]; then
			data=$(probe "$pane" 2>/dev/null) || reason=unresumable
		fi
		if [ -z "$reason" ]; then
			sid=$(jq -r '.sessionId // empty' <<<"$data")
			pid=$(jq -r '.pid // empty' <<<"$data")
			[ "$(jq -r '.kind // empty' <<<"$data")" = "$kind" ] || reason=identity-mismatch
			key="$kind:$sid"
			if jq -e --arg key "$key" '.[$key] == true' <<<"$pins" >/dev/null; then
				tmux set-option -p -t "$pane" @agent_hibernate_pinned on 2>/dev/null || true
				reason=pinned
			else
				tmux set-option -pu -t "$pane" @agent_hibernate_pinned 2>/dev/null || true
			fi
		fi
		[ -n "$reason" ] || reason=eligible
		printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
			"$pane" "$reason" "$since" "$kind" "$sid" "$pid" "$(pin_revision)"
	done
}

read_policy() {
	if [ -f "$POLICY_FILE" ]; then
		jq -ec 'select(type == "object" and
		  ([.criticalStreak,.criticalSince,.episodeActions,.belowSince,.lastEvaluationAt,.lastActionAt] |
		   all(. == null or (type == "number" and . >= 0))))' "$POLICY_FILE" 2>/dev/null
		return $?
	fi
	printf '{"criticalStreak":0,"criticalSince":0,"episodeActions":0,"belowSince":0,"lastEvaluationAt":0,"lastActionAt":0}\n'
}

write_policy() {
	local tmp="$POLICY_FILE.tmp.$$"
	mkdir -p "$STATE_DIR"
	printf '%s\n' "$1" >"$tmp"
	chmod 600 "$tmp"
	mv -f "$tmp" "$POLICY_FILE"
}

event() {
	local now=$1 mode_value=$2 pressure=$3 outcome=$4 pane=${5:-} reason=${6:-}
	mkdir -p "$STATE_DIR"
	jq -cn --argjson ts "$now" --arg mode "$mode_value" --arg pressure "$pressure" \
		--arg outcome "$outcome" --arg pane "$pane" --arg reason "$reason" \
		'{ts:$ts,mode:$mode,pressure:$pressure,outcome:$outcome,pane:$pane,reason:$reason}' >>"$EVENTS_FILE"
	chmod 600 "$EVENTS_FILE"
}

cmd_status() {
	local json=0 now=${AGENT_AUTO_NOW:-$(date +%s)} pins pressure rows
	[ "${1:-}" = --json ] && json=1
	pins=$(pins_json) || die 1 'pin store is malformed'
	pressure=${AGENT_AUTO_MEMORY_STATE:-$(mem_state)}
	rows=$(gather_candidates "$now" "$pins")
	while IFS=$'\t' read -r pane _ _ _ _ _ _; do
		[ -n "$pane" ] && sync_pin_mirror "$pane" "$pins" >/dev/null || true
	done <<<"$rows"
	if [ "$json" -eq 1 ]; then
		printf '%s\n' "$rows" | jq -R -s --arg mode "$(mode)" --arg pressure "$pressure" '
		  {mode:$mode,pressure:$pressure,panes:(split("\n")|map(select(length>0)|split("\t"))|
		  map({pane:.[0],decision:.[1],idleSince:(.[2] | tonumber? // null),kind:.[3],sessionId:(.[4]//"")}))}'
	else
		printf 'mode=%s pressure=%s\n' "$(mode)" "$pressure"
		printf '%s\n' "$rows" | awk -F '\t' 'NF { printf "%s\t%s\t%s\n", $1, $2, $4 }'
	fi
}

cmd_mode() {
	case "${1:-}" in off | observe | on) ;; *) die 2 'mode must be off, observe, or on' ;; esac
	tmux set-option -g @agent_auto_hibernate "$1"
	printf 'auto-hibernate %s\n' "$1"
}

cmd_tick() {
	local now=${AGENT_AUTO_NOW:-$(date +%s)} mode_value pressure policy streak critical_since actions below last_eval pins rows chosen expected outcome
	mkdir -p "$STATE_DIR"
	TICK_LOCK="$STATE_DIR/tick.lock"
	mkdir "$TICK_LOCK" 2>/dev/null || return 0
	mode_value=$(mode)
	[ "$mode_value" != off ] || return 0
	pressure=${AGENT_AUTO_MEMORY_STATE:-$(mem_state)}
	policy=$(read_policy) || {
		event "$now" "$mode_value" "$pressure" refused '' malformed-policy
		return 0
	}
	streak=$(jq -r '.criticalStreak // 0' <<<"$policy")
	critical_since=$(jq -r '.criticalSince // 0' <<<"$policy")
	actions=$(jq -r '.episodeActions // 0' <<<"$policy")
	below=$(jq -r '.belowSince // 0' <<<"$policy")
	last_eval=$(jq -r '.lastEvaluationAt // 0' <<<"$policy")
	if [ "$pressure" != CRITICAL ]; then
		streak=0
		[ "$below" -gt 0 ] || below=$now
		if [ $((now - below)) -ge "$RESET_AFTER" ]; then actions=0; fi
		policy=$(jq -c --argjson streak "$streak" --argjson actions "$actions" --argjson below "$below" \
			'.criticalStreak=$streak|.criticalSince=0|.episodeActions=$actions|.belowSince=$below' <<<"$policy")
		write_policy "$policy"
		return 0
	fi
	[ "$streak" -gt 0 ] || critical_since=$now
	streak=$((streak + 1))
	below=0
	policy=$(jq -c --argjson streak "$streak" --argjson since "$critical_since" '.criticalStreak=$streak|.criticalSince=$since|.belowSince=0' <<<"$policy")
	if [ "$streak" -lt "$CRITICAL_SAMPLES" ] || [ $((now - critical_since)) -lt "$SUSTAINED_FOR" ] ||
		[ $((now - last_eval)) -lt "$COOLDOWN" ] || [ "$actions" -ge "$EPISODE_CAP" ]; then
		write_policy "$policy"
		return 0
	fi
	pins=$(pins_json) || {
		event "$now" "$mode_value" "$pressure" refused '' malformed-pins
		return 0
	}
	rows=$(gather_candidates "$now" "$pins")
	chosen=$(printf '%s\n' "$rows" | awk -F '\t' '$2=="eligible"' | sort -t $'\t' -k3,3n | head -1)
	policy=$(jq -c --argjson now "$now" '.lastEvaluationAt=$now' <<<"$policy")
	if [ -z "$chosen" ]; then
		event "$now" "$mode_value" "$pressure" no-candidate
		write_policy "$policy"
		return 0
	fi
	IFS=$'\t' read -r pane _ since kind sid pid revision <<<"$chosen"
	expected=$(jq -cn --arg pane "$pane" --arg kind "$kind" --arg sid "$sid" --argjson pid "$pid" \
		--arg idle "$since" --arg revision "$revision" \
		'{pane:$pane,kind:$kind,sessionId:$sid,pid:$pid,idleSince:$idle,pinRevision:$revision}')
	if [ "$mode_value" = observe ]; then
		event "$now" "$mode_value" "$pressure" proposed "$pane"
		write_policy "$policy"
		return 0
	fi
	if AGENT_HIBERNATE_AUTO_EXPECTED="$expected" AGENT_AUTO_PINS_FILE="$PINS_FILE" \
		"$ENGINE" hibernate "$pane" --auto; then
		actions=$((actions + 1))
		policy=$(jq -c --argjson now "$now" --argjson actions "$actions" \
			'.lastActionAt=$now|.episodeActions=$actions|.criticalStreak=0' <<<"$policy")
		event "$now" "$mode_value" "$pressure" hibernated "$pane"
	else
		outcome=$?
		if [ "$outcome" -eq 7 ]; then
			tmux set-option -g @agent_auto_hibernate observe 2>/dev/null || true
			event "$now" "$mode_value" "$pressure" recovery-failure "$pane" "engine-$outcome"
		else
			event "$now" "$mode_value" "$pressure" refused "$pane" "engine-$outcome"
		fi
	fi
	write_policy "$policy"
}

case "${1:-status}" in
status)
	shift
	cmd_status "$@"
	;;
mode)
	shift
	cmd_mode "${1:-}"
	;;
pin)
	shift
	cmd_pin "${1:-}"
	;;
unpin)
	shift
	cmd_unpin "${1:-}"
	;;
tick) cmd_tick ;;
*) die 2 'usage: agent-autohibernate.sh <status [--json] | mode off|observe|on | pin PANE | unpin PANE | tick>' ;;
esac
