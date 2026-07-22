#!/bin/sh
# agent-cli-lib.sh — functional core shared by the `agent` CLI and the agents
# popup: target resolution + the single agent-pane enumerator, plus the pure
# decision helpers the CLI's verbs compose. Sourced (never executed), like
# agent-state-lib.sh; function-locals are _underscore-prefixed and always
# assigned before use so `set -u` callers are not clobbered or tripped.
#
# Requires agent-state-lib.sh (rank() backs agent_rank_sort). Sourced
# unconditionally from $AGENT_STATE_LIB (default: the sibling file — the lib
# cannot self-locate portably when sourced); it is pure function definitions,
# so re-sourcing is idempotent for callers that already pulled it in
# (agent-popup.sh has).

# shellcheck disable=SC1090,SC1091
. "${AGENT_STATE_LIB:-$HOME/.config/tmux/scripts/agent-state-lib.sh}"

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
		_matches=$(agent_list_rows | awk -F '\t' -v n="$_t" '$4 == n { print $1 }')
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
# carrying @agent_state, in positional order (session → window index → pane
# index). Fields:
#   pane_id  state  kind  name  session:win.pane  window_name  cwd(full)
# cycle() consumes positional order directly; consumers wanting attention
# order (the popup's list, `agent ls`) pipe through agent_rank_sort.
agent_list_rows() {
	_tab=$(printf '\t')
	tmux list-panes -a -F \
		"#{session_name}	#{window_index}	#{pane_index}	#{pane_id}	#{@agent_state}	#{@agent_kind}	#{@agent_name}	#{window_name}	#{pane_current_path}" \
		2>/dev/null |
		sort -t "$_tab" -k1,1 -k2,2n -k3,3n |
		awk -F '\t' 'BEGIN { OFS = "\t" }
		$5 != "" { print $4, $5, $6, $7, $1 ":" $2 "." $3, $8, $9 }'
}

# agent_rank_sort — filter agent_list_rows output into attention order:
# rank desc (blocked > done > working > idle), positional order as the
# tie-break (`sort -s`: the stable sort keeps input order within a rank).
# The rank values are the canonical rank() from agent-state-lib.sh, injected
# into awk via -v (awk cannot call sh) — the same idiom the popup uses for
# glyphs, so the mapping lives in exactly one place.
agent_rank_sort() {
	_tab=$(printf '\t')
	awk -F '\t' -v OFS='\t' \
		-v r_blocked="$(rank blocked)" -v r_done="$(rank 'done')" \
		-v r_working="$(rank working)" -v r_idle="$(rank idle)" '
		BEGIN {
			r["blocked"] = r_blocked; r["done"] = r_done
			r["working"] = r_working; r["idle"] = r_idle
		}
		{ print ($2 in r ? r[$2] : 0), $0 }' |
		sort -t "$_tab" -k1,1rn -s |
		cut -f2-
}

# agent_name_taken NAME [EXCLUDE_PANE] — true iff some *other* live agent pane
# already carries @agent_name == NAME. Callers sweep first (agent-sweep.sh
# clears dead panes' names), so this is the "unique among live agents" check.
# EXCLUDE_PANE lets a pane re-apply its own name without a self-collision.
# Scoped to agent_list_rows' view — state-carrying panes — so a ghost name on
# a stateless pane (only settable out-of-band; the mutator refuses it) does
# not count as taken.
agent_name_taken() {
	_name=$1
	_exclude=${2:-}
	_hit=$(agent_list_rows |
		awk -F '\t' -v n="$_name" -v x="$_exclude" '$1 != x && $4 == n { print 1; exit }')
	[ -n "$_hit" ]
}
