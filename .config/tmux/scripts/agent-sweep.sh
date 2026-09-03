#!/bin/sh
# agent-sweep.sh — the phase-5 reconcile net behind the hooks-first model. Three jobs:
#   (1) discover Claude/Codex presence from each pane's foreground process group
#       and retire stale dots after a confirmed return to the shell;
#   (2) age a `done` dot you are currently looking at to idle — a backstop for the
#       focus hooks' `seen`, which the focus events miss under concurrent-agent
#       churn (you watch one agent while another finishes, then return to it
#       without a fresh select-pane/window-changed transition);
#   (3) reconcile Codex's OSC title spinner to working/idle.
#
# Presence and activity are separate evidence channels. The kernel foreground
# process group owns presence; agent hooks own blocked/done and the instant
# working path. Inspect the whole group because launchers such as handoff keep a
# zsh and Python wrapper in front of the real agent. An unknown non-shell group
# is preserved rather than guessed absent.
#
#   agent-sweep.sh            # one-shot sweep (default)
#   agent-sweep.sh daemon     # single per-server background loop (≤POLL clearing)
#
# Quiet no-op when there is no tmux or no running server.

set -u

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=agent-state-lib.sh disable=SC1091
. "$SELF_DIR/agent-state-lib.sh"
# shellcheck source=agent-journal.sh disable=SC1091
. "$SELF_DIR/agent-journal.sh"

AGENT_PRESENCE_GRACE=${AGENT_PRESENCE_GRACE:-10}
AGENT_PS=${AGENT_PS:-ps}

# sweep_once — reconcile every dot in one pass: read all panes once, clear panes
# whose agent died (shell foreground), age a `done` dot you are currently looking
# at to idle, and recompute the rollup for every affected window plus any window
# still showing a stale @win_agent_state.
sweep_once() {
	command -v tmux >/dev/null 2>&1 || return 0
	tmux list-sessions >/dev/null 2>&1 || return 0

	# @agent_kind and pane_title feed the codex title-spinner reconcile below;
	# pane_title is last because it is freeform (a stray tab in a title can't then
	# misalign the earlier columns).
	_rows=$(tmux list-panes -a -F \
		"#{window_id}	#{pane_id}	#{@agent_state}	#{pane_current_command}	#{@win_agent_state}	#{pane_active}	#{window_active}	#{session_attached}	#{@agent_kind}	#{@agent_presence_absent_since}	#{pane_pid}	#{pane_title}" \
		2>/dev/null) || return 0

	# Sanitise the process table immediately: only ids plus an exact argv0 class
	# leave awk. Full argv can contain secrets and must never reach a shell variable
	# or the journal. `ps` status is carried through the pipeline so a failed probe
	# becomes unknown, never false absence.
	_snapshot=$({
		"$AGENT_PS" -ww -axo pid=,pgid=,tpgid=,args=
		printf '__agent_ps_status__ %s\n' "$?"
	} 2>/dev/null | awk '
		$1 == "__agent_ps_status__" { print "S\t" $2; next }
		{
			arg0 = $4
			sub(/^.*\//, "", arg0)
			sub(/^-/, "", arg0)
			kind = (arg0 == "claude" || arg0 == "codex") ? arg0 : ""
			shell = (arg0 == "zsh" || arg0 == "bash" || arg0 == "sh" ||
				arg0 == "fish" || arg0 == "dash" || arg0 == "ash") ? 1 : 0
			print "R\t" $1 "\t" $2 "\t" $3 "\t" kind "\t" shell
		}')

	# Join every pane to its foreground group in one awk process. Output starts
	# with OBSERVATION and OBSERVED_KIND, followed by the untouched tmux row so a
	# tab in the freeform title remains harmless at the end.
	_observed_rows=$({
		while IFS= read -r _row; do
			[ -n "$_row" ] && printf 'P\t%s\n' "$_row"
		done <<EOF
$_rows
EOF
		printf '%s\n' "$_snapshot"
	} | awk -F '\t' '
		$1 == "P" {
			pane[++pane_count] = $3
			pane_pid[$3] = $12
			raw[$3] = substr($0, 3)
			next
		}
		$1 == "R" {
			pid[++proc_count] = $2
			pgid[proc_count] = $3
			tpgid[$2] = $4
			kind[proc_count] = $5
			shell[proc_count] = $6
			next
		}
		$1 == "S" { probe_status = $2 }
		END {
			OFS = "\t"
			for (i = 1; i <= pane_count; i++) {
				p = pane[i]
				obs = "unknown"; observed = ""
				fg = tpgid[pane_pid[p]] + 0
				if (probe_status == 0 && fg > 0) {
					leader = ""; leader_shell = 0; claude = 0; codex = 0
					members = 0
					for (j = 1; j <= proc_count; j++) {
						if ((pgid[j] + 0) != fg) continue
						members++
						if (kind[j] == "claude") claude = 1
						if (kind[j] == "codex") codex = 1
						if ((pid[j] + 0) == fg) {
							leader = kind[j]
							leader_shell = shell[j]
						}
					}
					if (leader != "") { obs = "present"; observed = leader }
					else if (claude + codex == 1) {
						obs = "present"; observed = claude ? "claude" : "codex"
					} else if (claude + codex > 1) obs = "unknown"
					else if (members > 0 && leader_shell == 1) obs = "absent"
				}
				print obs, observed, raw[p]
			}
		}')

	# Codex has no "model generating" hook event, so a pane the Stop hook aged to
	# idle (or a turn resumed without a fresh UserPromptSubmit) sits green while
	# actively computing. Its OSC title carries a braille spinner while working,
	# which tmux exposes as #{pane_title} — the app's own status channel, read
	# once here. Global opt-out mirrors @cross_session_badge.
	_codex_poll=$(tmux show-options -gqv @codex_title_poll 2>/dev/null) || _codex_poll=

	_tab=$(printf '\t')
	_windows=
	_changed=0
	_now=${AGENT_PRESENCE_NOW:-$(date +%s)}
	case $_now in '' | *[!0-9]*) _now=0 ;; esac
	case $AGENT_PRESENCE_GRACE in '' | *[!0-9]*) _grace=10 ;; *) _grace=$AGENT_PRESENCE_GRACE ;; esac
	# Manual tab-split (not IFS read): tab is IFS-whitespace, so consecutive tabs
	# from an empty @agent_state field would collapse and misalign the columns.
	while IFS= read -r _line; do
		[ -n "$_line" ] || continue
		_observation=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_observed_kind=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_win=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_pane=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_astate=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_cmd=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_wstate=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_pactive=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_wactive=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_sattached=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_kind=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_absent_since=${_line%%"$_tab"*}
		_line=${_line#*"$_tab"}
		_pane_pid=${_line%%"$_tab"*}
		_ptitle=${_line#*"$_tab"}

		if [ "$_astate" != hibernated ]; then
			case $_observation in
			present)
				if [ -n "$_absent_since" ]; then
					tmux set-option -pu -t "$_pane" @agent_presence_absent_since 2>/dev/null || true
					_absent_since=
				fi
				if [ -z "$_astate" ] || [ "$_kind" != "$_observed_kind" ]; then
					_previous_state=$_astate
					_previous_kind=$_kind
					_reason=acquired
					[ -n "$_kind" ] && _reason=kind-changed
					if [ -n "$_kind" ] && [ "$_kind" != "$_observed_kind" ]; then
						tmux set-option -pu -t "$_pane" @agent_name 2>/dev/null || true
						tmux set-option -pu -t "$_pane" @claude_profile 2>/dev/null || true
					fi
					tmux set-option -p -t "$_pane" @agent_kind "$_observed_kind" 2>/dev/null || true
					tmux set-option -p -t "$_pane" @agent_state idle 2>/dev/null || true
					_kind=$_observed_kind
					_astate=idle
					journal_presence_event "$_reason" "$_pane" "$_win" \
						"$_previous_state" "$_previous_kind" "$_observed_kind" idle 0
					_windows="$_windows$_win
"
					_changed=1
				fi
				;;
			absent)
				if [ -n "$_astate" ]; then
					case $_absent_since in '' | *[!0-9]*)
						tmux set-option -p -t "$_pane" @agent_presence_absent_since "$_now" 2>/dev/null || true
						_changed=1
						;;
					*)
						if [ $((_now - _absent_since)) -ge "$_grace" ] 2>/dev/null; then
							_age=$((_now - _absent_since))
							_previous_state=$_astate
							_previous_kind=$_kind
							tmux set-option -pu -t "$_pane" @agent_state 2>/dev/null || true
							tmux set-option -pu -t "$_pane" @agent_kind 2>/dev/null || true
							tmux set-option -pu -t "$_pane" @agent_name 2>/dev/null || true
							tmux set-option -pu -t "$_pane" @agent_poll_absent 2>/dev/null || true
							tmux set-option -pu -t "$_pane" @agent_presence_absent_since 2>/dev/null || true
							tmux set-option -pu -t "$_pane" @claude_profile 2>/dev/null || true
							_astate=
							_kind=
							journal_presence_event released "$_pane" "$_win" \
								"$_previous_state" "$_previous_kind" "" "" "$_age"
							_windows="$_windows$_win
"
							_changed=1
						fi
						;;
					esac
				fi
				;;
			unknown)
				if [ -n "$_absent_since" ]; then
					tmux set-option -pu -t "$_pane" @agent_presence_absent_since 2>/dev/null || true
					_changed=1
				fi
				;;
			esac
		fi

		# Agent still present (or conservatively unknown): age a viewed done dot.
		if [ -n "$_astate" ] && [ "$_observation" != absent ] &&
			[ "$_astate" = "done" ] && is_viewing "$_pactive" "$_wactive" "$_sattached"; then
			tmux set-option -p -t "$_pane" @agent_state idle 2>/dev/null || true
			_astate=idle
			_windows="$_windows$_win
"
			_changed=1
		fi

		# Spinner evidence is meaningful only after the process observer confirms
		# this foreground group as Codex.
		if [ "$_observation" = present ] && [ "$_observed_kind" = codex ] &&
			[ "$_codex_poll" != off ]; then
			_spin=0
			has_spinner "$_ptitle" && _spin=1
			_pabsent=$(tmux show-options -pqv -t "$_pane" @agent_poll_absent 2>/dev/null) || _pabsent=
			_step=$(codex_working_step "$_astate" "$_spin" "${_pabsent:-0}")
			_nstate=${_step% *}
			_nabsent=${_step##* }
			if [ "$_nstate" != "$_astate" ]; then
				tmux set-option -p -t "$_pane" @agent_state "$_nstate" 2>/dev/null || true
				_windows="$_windows$_win
"
				_changed=1
			fi
			if [ "$_nabsent" != "${_pabsent:-0}" ]; then
				if [ "$_nabsent" = 0 ]; then
					tmux set-option -pu -t "$_pane" @agent_poll_absent 2>/dev/null || true
				else
					tmux set-option -p -t "$_pane" @agent_poll_absent "$_nabsent" 2>/dev/null || true
				fi
				_changed=1
			fi
		fi
		# Re-roll any window still showing a dot too: hard-closing the worst pane
		# drops its own @agent_state but leaves the rollup stale with no pane to
		# target, so the recompute has to be driven from the window.
		[ -n "$_wstate" ] && _windows="$_windows$_win
"
	done <<EOF
$_observed_rows
EOF

	[ "$_changed" = 1 ] || [ -n "$_windows" ] || return 0

	printf '%s' "$_windows" | sort -u | while IFS= read -r _w; do
		[ -n "$_w" ] || continue
		roll_window "$_w"
		roll_sessions_for_window "$_w"
	done

	tmux refresh-client -S 2>/dev/null || true
}

# _is_sweep PID — true if PID is an agent-sweep process (guards the pidfile
# against PID reuse). /proc on Linux, ps fallback on macOS (no /proc).
_is_sweep() {
	if [ -r "/proc/$1/cmdline" ]; then
		tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null | grep -q agent-sweep
	else
		ps -p "$1" -o command= 2>/dev/null | grep -q agent-sweep
	fi
}

# daemon — one background loop per tmux server. Clears stale dots every POLL
# while a client is attached; self-terminates when the server dies.
daemon() {
	command -v tmux >/dev/null 2>&1 || return 0
	tmux list-sessions >/dev/null 2>&1 || return 0

	_state_dir=${AGENT_SWEEP_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-sweep}
	_server_pid=$(tmux display-message -p '#{pid}' 2>/dev/null)
	[ -n "$_server_pid" ] || return 0
	_pidfile="$_state_dir/server-$_server_pid.pid"

	# Single-instance guard: a live agent-sweep daemon already owns this server.
	if [ -f "$_pidfile" ]; then
		_old=$(cat "$_pidfile" 2>/dev/null || true)
		if [ -n "$_old" ] && kill -0 "$_old" 2>/dev/null && _is_sweep "$_old"; then
			return 0
		fi
	fi

	# Own a process group so teardown can signal the whole tree. setsid is absent
	# on macOS — fall back to running in place (run-shell -b already detached us),
	# exactly as claude-watcher does.
	if [ -z "${AGENT_SWEEP_SETSID:-}" ] && command -v setsid >/dev/null 2>&1; then
		AGENT_SWEEP_SETSID=1 exec setsid "$SELF_DIR/$(basename -- "$0")" daemon
	fi

	mkdir -p "$_state_dir"
	printf '%s\n' "$$" >"$_pidfile"
	# EXIT cleans the pidfile; INT/TERM must *exit* (a bare signal trap would run
	# then resume the loop) so the EXIT trap fires.
	trap 'rm -f "$_pidfile" 2>/dev/null' EXIT
	trap 'exit 143' TERM
	trap 'exit 130' INT

	while :; do
		sleep "${AGENT_SWEEP_POLL:-10}"
		tmux list-sessions >/dev/null 2>&1 || break
		sweep_once
	done
}

case "${1:-}" in
"" | sweep | sweep_once) sweep_once ;;
sync) sync_agent_rollups ;;
daemon) daemon ;;
*)
	printf 'usage: %s [sweep|sync|daemon]\n' "$(basename -- "$0")" >&2
	exit 2
	;;
esac
