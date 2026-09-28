#!/bin/sh
# agent-journal.sh — durable JSONL journal of agent lifecycle events (phase 0).
#
# Sourced (never executed) by agent-state.sh, the funnel every coding agent's
# hooks already call. The state dots keep only the *current* state as tmux pane
# options; the journal appends each event — with a curated slice of the hook's
# stdin payload — to ~/.local/state/agent-journal/events-YYYY-MM.jsonl so
# downstream consumers (sequencers, "what happened overnight" audits) can
# replay history. Monthly files keep retention simple (journal_retain).
#
# Curated on purpose: hook payloads carry full tool inputs (file contents,
# command lines — potentially secrets). Only identity/lifecycle fields are
# kept, plus the full tool_input for ExitPlanMode alone: that is the plan text,
# and its schema is undocumented, so recording it verbatim doubles as the probe.
#
# Fail-open: no jq, unwritable dir, or unparseable stdin must never break the
# dot pipeline. Disable with AGENT_JOURNAL_DISABLE=1; relocate with
# AGENT_JOURNAL_DIR (tests use both).

# journal_capture_stdin — capture the first 1MiB of hook stdin into
# AGENT_JOURNAL_PAYLOAD and drain the rest, so the hook writer never sees
# EPIPE (payloads can be huge — a Write tool_input carries the whole file).
# Replaces the old drain-only behaviour; a no-op on a tty (manual invocation).
journal_capture_stdin() {
	AGENT_JOURNAL_PAYLOAD=
	[ -t 0 ] && return 0
	AGENT_JOURNAL_PAYLOAD=$({
		head -c 1048576
		cat >/dev/null
	} 2>/dev/null) || AGENT_JOURNAL_PAYLOAD=
}

# journal_event STATE KIND PANE WINDOW — append one curated JSONL line for this
# event. Unparseable or empty payloads still journal (hook fields null): the
# state transition itself is the signal, the payload is enrichment.
journal_event() {
	[ "${AGENT_JOURNAL_DISABLE:-0}" = 1 ] && return 0
	command -v jq >/dev/null 2>&1 || return 0
	_dir=${AGENT_JOURNAL_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-journal}
	mkdir -p "$_dir" 2>/dev/null || return 0
	_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	_file=$_dir/events-$(printf '%.7s' "$_ts").jsonl
	# Redirection, not a producer pipe: jq deliberately reads one JSON value, so
	# a large multi-value payload must not make printf lose a broken-pipe race.
	jq -cn \
		--arg ts "$_ts" --arg state "$1" --arg kind "$2" \
		--arg pane "$3" --arg window "$4" '
		(try input catch null) as $h |
		{ts: $ts, pane: $pane, window: $window, state: $state,
		 kind: (if $kind == "" then null else $kind end),
		 event: $h.hook_event_name?,
		 session_id: $h.session_id?,
		 cwd: $h.cwd?,
		 permission_mode: $h.permission_mode?,
		 notification_type: $h.notification_type?,
		 message: $h.message?,
		 tool_name: $h.tool_name?,
		 stop_reason: $h.stop_reason?,
		 plan: (if $h.tool_name? == "ExitPlanMode" then $h.tool_input? else null end)}
	' >>"$_file" 2>/dev/null <<EOF || true
${AGENT_JOURNAL_PAYLOAD:-}
EOF
}

# journal_presence_event REASON PANE WINDOW PREVIOUS_STATE PREVIOUS_KIND
# OBSERVED_KIND STATE AGE — append a process-reconciliation transition. This
# path has no hook payload. Keep it metadata-only so process arguments never
# enter the journal.
journal_presence_event() {
	[ "${AGENT_JOURNAL_DISABLE:-0}" = 1 ] && return 0
	command -v jq >/dev/null 2>&1 || return 0
	_dir=${AGENT_JOURNAL_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-journal}
	mkdir -p "$_dir" 2>/dev/null || return 0
	_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	_file=$_dir/events-$(printf '%.7s' "$_ts").jsonl
	jq -cn \
		--arg ts "$_ts" --arg reason "$1" --arg pane "$2" --arg window "$3" \
		--arg previous_state "$4" --arg previous_kind "$5" \
		--arg observed_kind "$6" --arg state "$7" --argjson age "${8:-0}" '
		{ts: $ts, pane: $pane, window: $window, event: "ProcessReconcile",
		 reason: $reason,
		 previous_state: (if $previous_state == "" then null else $previous_state end),
		 previous_kind: (if $previous_kind == "" then null else $previous_kind end),
		 observed_kind: (if $observed_kind == "" then null else $observed_kind end),
		 state: (if $state == "" then null else $state end), age_seconds: $age}
	' >>"$_file" 2>/dev/null || true
}

# journal_month_index YYYY-MM — months since year 0, for age arithmetic. The
# leading zero is stripped: sh reads 08 and 09 as invalid octal.
journal_month_index() {
	_m=${1#*-}
	echo $((${1%-*} * 12 + ${_m#0}))
}

# journal_retain — cap the journal: gzip each month older than the previous
# one, and delete every month more than three back. The current and previous
# month stay plain .jsonl because the plan viewer (lib/claude-plan.sh) reads
# the two newest plain files. Cheap when there is nothing to do, so the sweep
# runs it every tick. Fail-open like the writers.
journal_retain() {
	_dir=${AGENT_JOURNAL_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-journal}
	[ -d "$_dir" ] || return 0
	_now_idx=$(journal_month_index "$(date -u +%Y-%m)")
	for _f in "$_dir"/events-*.jsonl "$_dir"/events-*.jsonl.gz; do
		[ -e "$_f" ] || continue
		_month=${_f##*/events-}
		_month=${_month%%.*}
		case $_month in [0-9][0-9][0-9][0-9]-[0-9][0-9]) ;; *) continue ;; esac
		_age=$((_now_idx - $(journal_month_index "$_month")))
		if [ "$_age" -gt 3 ]; then
			rm -f "$_f" 2>/dev/null || true
		elif [ "$_age" -gt 1 ] && [ "${_f%.gz}" = "$_f" ]; then
			gzip -f "$_f" 2>/dev/null || true
		fi
	done
}
