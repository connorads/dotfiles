#!/bin/sh
# agent-cli-lib.sh — functional core shared by the `agent` CLI and the agents
# popup: target resolution + the single agent-pane enumerator, plus the pure
# decision helpers the CLI's verbs compose. Sourced (never executed), like
# agent-state-lib.sh; function-locals are _underscore-prefixed and always
# assigned before use so `set -u` callers are not clobbered or tripped.
#
# Requires agent-state-lib.sh. When the caller has not already sourced it
# (agent-popup.sh has), the guard pulls it in from $AGENT_STATE_LIB (default:
# the sibling file) — the lib cannot self-locate portably when sourced.

if ! command -v rank >/dev/null 2>&1; then
	# shellcheck disable=SC1090,SC1091
	. "${AGENT_STATE_LIB:-$HOME/.config/tmux/scripts/agent-state-lib.sh}"
fi

# agent_pane_state PANE — echo PANE's @agent_state (empty when unset or gone).
agent_pane_state() {
	tmux display-message -p -t "$1" '#{@agent_state}' 2>/dev/null
}

# agent_pane_kind PANE — echo PANE's @agent_kind (empty when unset or gone).
agent_pane_kind() {
	tmux display-message -p -t "$1" '#{@agent_kind}' 2>/dev/null
}

# agent_state_matches STATE CSV — true iff STATE is a member of the comma-
# separated CSV (e.g. agent_state_matches done "done,idle"). Empty STATE never
# matches. Pure.
agent_state_matches() {
	_s=${1:-}
	[ -n "$_s" ] || return 1
	case ",${2:-}," in
	*",$_s,"*) return 0 ;;
	*) return 1 ;;
	esac
}

# agent_prompt_gate STATE FORCE — echo the prompt decision for a pane in STATE:
# send | refuse-blocked | refuse-working. blocked is a human approval surface
# (permission prompt / question) and working panes are mid-turn, so both refuse
# unless FORCE=1; idle/done/untracked send. Pure decision core — the CLI's
# imperative shell maps refuse-* to exit 4.
agent_prompt_gate() {
	_force=${2:-0}
	case ${1:-} in
	blocked) if [ "$_force" = 1 ]; then echo send; else echo refuse-blocked; fi ;;
	working) if [ "$_force" = 1 ]; then echo send; else echo refuse-working; fi ;;
	*) echo send ;;
	esac
}

# agent_submit_key KIND — the tmux key that submits a typed prompt for KIND.
# Every tracked kind submits with Enter today; KIND stays the seam for future
# per-kind tuning. Pure.
agent_submit_key() {
	echo "C-m"
}

# agent_resolve_target TARGET — echo TARGET's canonical pane_id (%N). TARGET is
# a pane id (%N), a tmux target address (session:win.pane), or an exact
# @agent_name match. 0-match and ambiguous-name both diagnose to stderr and
# return 3 (the CLI's target-unresolvable code); a missing TARGET returns 2.
agent_resolve_target() {
	_t=${1:-}
	if [ -z "$_t" ]; then
		echo "agent: missing target" >&2
		return 2
	fi
	case $_t in
	%* | *:*)
		if _id=$(tmux display-message -p -t "$_t" '#{pane_id}' 2>/dev/null) &&
			[ -n "$_id" ]; then
			printf '%s\n' "$_id"
		else
			echo "agent: no such pane: $_t" >&2
			return 3
		fi
		;;
	*)
		_matches=$(tmux list-panes -a -F '#{pane_id}	#{@agent_name}' 2>/dev/null |
			awk -F '\t' -v n="$_t" '$2 == n { print $1 }')
		_count=0
		_first=
		while IFS= read -r _m; do
			[ -n "$_m" ] || continue
			_count=$((_count + 1))
			[ -n "$_first" ] || _first=$_m
		done <<EOF
$_matches
EOF
		case $_count in
		0)
			echo "agent: no agent named '$_t'" >&2
			return 3
			;;
		1) printf '%s\n' "$_first" ;;
		*)
			echo "agent: ambiguous name '$_t' (panes: $(printf '%s' "$_matches" | tr '\n' ' '))" >&2
			return 3
			;;
		esac
		;;
	esac
}

# agent_list_rows — the single agent-pane enumerator: one TSV row per pane
# carrying @agent_state, ranked by attention (rank desc, ties keep tmux's
# enumeration order). Fields:
#   pane_id  state  kind  name  session:win.pane  window_name  cwd(full)
# The agents popup decorates these rows with glyphs for fzf; the CLI prints
# them as-is. rank() mirrors agent-state-lib.sh (awk cannot call sh; trivial
# + pinned by agent-popup.bats/agent-cli.bats).
agent_list_rows() {
	tmux list-panes -a -F \
		"#{pane_id}	#{@agent_state}	#{@agent_kind}	#{@agent_name}	#{session_name}:#{window_index}.#{pane_index}	#{window_name}	#{pane_current_path}" \
		2>/dev/null |
		awk -F '\t' '
		function rank(s) {
			if (s == "blocked") return 4
			if (s == "done")    return 3
			if (s == "working") return 2
			if (s == "idle")    return 1
			return 0
		}
		$2 != "" { n++; row[n] = $0; r[n] = rank($2) }
		END {
			# Stable insertion sort by rank desc (ties keep enumeration order).
			for (i = 1; i <= n; i++) idx[i] = i
			for (i = 2; i <= n; i++) {
				key = idx[i]; j = i - 1
				while (j >= 1 && r[idx[j]] < r[key]) { idx[j + 1] = idx[j]; j-- }
				idx[j + 1] = key
			}
			for (i = 1; i <= n; i++) print row[idx[i]]
		}'
}
