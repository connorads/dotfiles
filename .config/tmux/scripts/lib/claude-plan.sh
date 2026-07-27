# shellcheck shell=bash
# claude-plan.sh — pure core for the Claude plan viewer (sourced, never executed).
#
# The plan viewer reads authoritative state from the agent journal rather than
# scraping live processes: agent-journal.sh records each ExitPlanMode hook with
# the full tool_input as `.plan` — carrying `.plan.plan` (the markdown) and
# `.plan.planFilePath` (an absolute path that already encodes the account,
# `…/.claude-profiles/code/<name>/…` vs `…/.claude/…`). We key on the tmux pane
# (session ids churn within one conversation) and intersect with live panes, so a
# reused %N can only ever surface its current occupant's plan.
#
# Testable with AGENT_JOURNAL_DIR (relocate the journal) plus a `tmux` stub on
# PATH (for the live-pane intersection). Requires jq.

# Under bash this needs bash >= 5, so the entry point that sources it must carry
# the re-exec preamble. Gated on BASH_VERSION because zsh callers source this
# too (agent-teleport, claude-session-adopt) and are unaffected.
if [ -n "${BASH_VERSION:-}" ] && [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	printf '%s: requires bash >= 5 (got %s)\n' "claude-plan.sh" "$BASH_VERSION" >&2
	# shellcheck disable=SC2317  # reachable: this file is sourced, not executed
	return 1 2>/dev/null || exit 1
fi

# claude_plan_journal_files — journal files newest month first, capped at the two
# most recent (a live pane's plan is never months old). Mirrors the path in
# agent-journal.sh; nullglob-safe (skips the literal glob when no file matches).
claude_plan_journal_files() {
	local dir="${AGENT_JOURNAL_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-journal}"
	local -a files=()
	local f
	for f in "$dir"/events-*.jsonl; do
		[ -e "$f" ] && files+=("$f")
	done
	[ ${#files[@]} -gt 0 ] || return 0
	# events-YYYY-MM.jsonl → lexical sort is chronological; reverse for newest first.
	printf '%s\n' "${files[@]}" | sort -r | head -2
}

# claude_plan_account_label <planFilePath> — the account a plan belongs to:
# `<name>` from `…/.claude-profiles/code/<name>/…`, else `default`. Pure string
# parse; the path already carries the account. (The jq in claude_plan_live_rows
# does not compute account — it emits accountless rows and the shell injects the
# label through this one function, so the parse lives in exactly one place.)
claude_plan_account_label() {
	case "$1" in
	*/.claude-profiles/code/*)
		local rest="${1#*/.claude-profiles/code/}"
		printf '%s\n' "${rest%%/*}"
		;;
	*) printf 'default\n' ;;
	esac
}

# claude_plan_live_rows — the single enumerator feeding both the fast path and
# the picker. Latest plan event per pane (absorbing session-id churn),
# intersected with live tmux panes, newest first. Emits TSV:
#   pane \t account \t name/window \t cwd-basename \t plan-title \t age \t planFilePath
# Field 1 (pane) is the hidden join key. Empty when the journal or jq is absent,
# or no live pane has a recorded plan.
claude_plan_live_rows() {
	command -v jq >/dev/null 2>&1 || return 0

	local live_tsv live_json
	live_tsv=$(tmux list-panes -a -F '#{pane_id}	#{@agent_name}	#{window_name}' 2>/dev/null) || return 0
	[ -n "$live_tsv" ] || return 0
	live_json=$(printf '%s\n' "$live_tsv" | jq -R -s '
		split("\n") | map(select(length > 0) | split("\t"))
		| map({(.[0]): {name: (.[1] // ""), window: (.[2] // "")}}) | add // {}')

	local -a jfiles=()
	mapfile -t jfiles < <(claude_plan_journal_files)
	[ ${#jfiles[@]} -gt 0 ] || return 0

	# Stage 1 streams (constant memory over a large journal) down to the compact
	# plan events; stage 2 slurps that small set to group per pane and rank.
	cat "${jfiles[@]}" 2>/dev/null |
		jq -c 'select(.plan != null)
			| {pane, ts, cwd, plan: .plan.plan, planFilePath: .plan.planFilePath}' |
		jq -rs --argjson live "$live_json" '
			def humanage($s):
				($s | floor) as $x
				| if $x < 60 then "\($x)s"
				  elif $x < 3600 then "\(($x / 60) | floor)m"
				  elif $x < 86400 then "\(($x / 3600) | floor)h"
				  else "\(($x / 86400) | floor)d" end;
			group_by(.pane) | map(max_by(.ts))
			| map(select(.pane | in($live)))
			| sort_by(.ts) | reverse
			| map(
				. as $e
				| $live[$e.pane] as $l
				| (($l.name // "") | if . != "" then . else ($l.window // "") end) as $nw
				| (($e.cwd // "") | split("/") | last // "") as $cwdb
				| (($e.plan // "") | split("\n")[0] | sub("^#+ *"; "")) as $title
				| (now - ($e.ts | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime)) as $age
				| [$e.pane, $nw, $cwdb, $title, humanage($age), ($e.planFilePath // "")])
			| .[] | @tsv' |
		while IFS=$'\t' read -r pane nw cwdb title age pf; do
			printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
				"$pane" "$(claude_plan_account_label "$pf")" "$nw" "$cwdb" "$title" "$age" "$pf"
		done
}

# claude_plan_inline_for_pane <pane> — the latest recorded plan markdown for a
# pane, straight from the journal. The fallback when its planFilePath is gone
# from disk. Empty when the pane has no recorded plan.
claude_plan_inline_for_pane() {
	command -v jq >/dev/null 2>&1 || return 0
	local pane="$1"
	local -a jfiles=()
	mapfile -t jfiles < <(claude_plan_journal_files)
	[ ${#jfiles[@]} -gt 0 ] || return 0
	cat "${jfiles[@]}" 2>/dev/null |
		jq -c --arg p "$pane" 'select(.plan != null and .pane == $p) | {ts, plan: .plan.plan}' |
		jq -rs 'if length == 0 then empty else (max_by(.ts) | .plan) end'
}
