#!/usr/bin/env bash
# agent-hibernate.sh: kill an idle Claude pane's process to reclaim RAM/swap,
# park a thawer in its place, and resume the same conversation on demand via
# `claude --resume`. SIGSTOP frees nothing (the leaked footprint stays mapped);
# kill + resume frees RAM and swap, resets the leak, and restores the
# conversation in full from the transcript.
#
#   agent-hibernate.sh hibernate <pane> [--force]  # snapshot, kill, park
#   agent-hibernate.sh thaw [<pane>|<session-id>]  # resume (no arg: fzf picker)
#   agent-hibernate.sh park                        # runs INSIDE the parked pane
#   agent-hibernate.sh list                        # records TSV (parked|orphan)
#
# Record store: one JSON file per hibernated session at
# ~/.local/state/agent-hibernate/<sessionId>.json, with the pane's screen
# capture alongside as <sessionId>.screen.txt. The session id is the only
# stable identity: pane ids die with the tmux server and pane keys drift on
# window moves, so both are stored as *current* addresses and refreshed (park
# re-addresses after a restore; the resurrect save pass refreshes live ones),
# never used as the key. No resolvable session id means no hibernation - a
# blind `--continue` could resume the wrong conversation.

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

set -uo pipefail

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SELF="$SELF_DIR/$(basename -- "${BASH_SOURCE[0]}")"

# Seams (env-overridable for tests, agent-popup.sh style).
STATE_DIR=${AGENT_HIBERNATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-hibernate}
SESSION_FILE=${AGENT_HIBERNATE_SESSION_FILE:-$HOME/.local/share/tmux/resurrect/session_ids.json}
AGENT_STATE_SH=${AGENT_STATE_SH:-$SELF_DIR/agent-state.sh}
JOURNAL_DIR=${AGENT_JOURNAL_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agent-journal}
MATERIALISE=${AGENT_HIBERNATE_MATERIALISE:-$HOME/.config/zsh/functions/claude-profile-materialise}
KILL_WAIT=${AGENT_HIBERNATE_KILL_WAIT:-5}

# Shared pane -> claude PID -> live session resolvers, and the argv flag filter
# the resurrect/fork paths already use - so hibernate snapshots identity exactly
# the way teleport and the save hook do.
# shellcheck source=lib/agent-session.sh disable=SC1091
. "$SELF_DIR/lib/agent-session.sh"
# shellcheck source=lib/resurrect-argv.sh disable=SC1091
. "$SELF_DIR/lib/resurrect-argv.sh"

die() {
	local code="$1"
	shift
	printf 'agent-hibernate: %s\n' "$*" >&2
	exit "$code"
}

# --- pure helpers ---------------------------------------------------------

# human_age SECS — compact single-unit age (3d / 5h / 12m / 40s).
human_age() {
	local s="${1:-0}"
	case "$s" in '' | *[!0-9]*) s=0 ;; esac
	if [ "$s" -ge 86400 ]; then
		echo "$((s / 86400))d"
	elif [ "$s" -ge 3600 ]; then
		echo "$((s / 3600))h"
	elif [ "$s" -ge 60 ]; then
		echo "$((s / 60))m"
	else
		echo "${s}s"
	fi
}

# prev_month YYYY-MM — the preceding month, pure arithmetic (no date -v/-d split).
prev_month() {
	local y="${1%%-*}" m="${1#*-}"
	m=$((10#$m - 1))
	if [ "$m" -eq 0 ]; then
		m=12
		y=$((y - 1))
	fi
	printf '%04d-%02d' "$y" "$m"
}

# iso_to_epoch ISO8601Z — epoch seconds; BSD date first, GNU fallback.
iso_to_epoch() {
	[ -n "${1:-}" ] || return 1
	date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null ||
		date -u -d "$1" +%s 2>/dev/null
}

# --- record store ----------------------------------------------------------

# record_matching FIELD VALUE — path of the first record whose FIELD == VALUE.
record_matching() {
	local field="$1" value="$2" rec
	[ -n "$value" ] || return 1
	for rec in "$STATE_DIR"/*.json; do
		[ -f "$rec" ] || continue
		if [ "$(jq -r --arg f "$field" '.[$f] // empty' "$rec" 2>/dev/null)" = "$value" ]; then
			printf '%s\n' "$rec"
			return 0
		fi
	done
	return 1
}

# record_for_cwd CWD — path of the record for CWD iff EXACTLY one matches
# (mirrors resurrect-claude-launch.sh's exactly-one cwd rule: never guess).
record_for_cwd() {
	local cwd="$1" rec hit="" n=0
	for rec in "$STATE_DIR"/*.json; do
		[ -f "$rec" ] || continue
		if [ "$(jq -r '.cwd // empty' "$rec" 2>/dev/null)" = "$cwd" ]; then
			hit="$rec"
			n=$((n + 1))
		fi
	done
	[ "$n" -eq 1 ] || return 1
	printf '%s\n' "$hit"
}

# readdress RECFILE PANE KEY — refresh the record's current tmux address.
readdress() {
	local recfile="$1" pane="$2" key="$3" tmp="$1.tmp.$$"
	if jq --arg pane "$pane" --arg key "$key" \
		'.pane = $pane | .paneKey = $key' "$recfile" >"$tmp" 2>/dev/null; then
		mv -f "$tmp" "$recfile"
	else
		rm -f "$tmp"
	fi
}

# pane_is_parked PANE — PANE exists and carries the hibernated state. The state
# check matters after a server restart: pane ids restart from %0, so a record's
# .pane can name an unrelated live pane until park/save refresh it.
pane_is_parked() {
	local pane="${1:-}" out
	[ -n "$pane" ] || return 1
	out=$(tmux display-message -p -t "$pane" '#{pane_id}	#{@agent_state}' 2>/dev/null) || return 1
	[ "$out" = "$(printf '%s\thibernated' "$pane")" ]
}

# last_journal_ts PANE — ts of PANE's last non-hibernated journal event, from
# the current + previous month files only (on-demand; the files run ~60MB/month).
last_journal_ts() {
	local pane="$1" cur f
	local -a files=()
	cur=$(date -u +%Y-%m)
	for f in "$JOURNAL_DIR/events-$(prev_month "$cur").jsonl" "$JOURNAL_DIR/events-$cur.jsonl"; do
		[ -f "$f" ] && files+=("$f")
	done
	[ "${#files[@]}" -gt 0 ] || return 0
	grep -h -F "\"pane\":\"$pane\"" "${files[@]}" 2>/dev/null |
		jq -r 'select(.state != "hibernated") | .ts // empty' 2>/dev/null | tail -n 1
}

# idle_age RECFILE — human age since the pane's last real activity (journal),
# falling back to the hibernation timestamp.
idle_age() {
	local recfile="$1" pane ts epoch now
	pane=$(jq -r '.pane // empty' "$recfile" 2>/dev/null)
	ts=$(last_journal_ts "$pane")
	[ -n "$ts" ] || ts=$(jq -r '.hibernatedAt // empty' "$recfile" 2>/dev/null)
	epoch=$(iso_to_epoch "$ts") || {
		echo '?'
		return 0
	}
	now=$(date -u +%s)
	human_age $((now - epoch))
}

# --- hibernate --------------------------------------------------------------

cmd_hibernate() {
	local force=0 pane="" arg
	for arg in "$@"; do
		case "$arg" in
		--force) force=1 ;;
		-*) die 2 "unknown flag: $arg" ;;
		*) pane="$arg" ;;
		esac
	done
	[ -n "$pane" ] || die 2 "usage: agent-hibernate.sh hibernate <pane> [--force]"
	command -v jq >/dev/null 2>&1 || die 1 "jq required"

	local info pane_pid pane_tty cwd pane_key
	info=$(tmux display-message -p -t "$pane" \
		'#{pane_id}	#{pane_pid}	#{pane_tty}	#{pane_current_path}	#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null)
	[ -n "$info" ] || die 3 "no such pane: $pane"
	IFS=$'\t' read -r pane pane_pid pane_tty cwd pane_key <<<"$info"

	# Gate on the agent state: idle/done are safe to kill; blocked holds a
	# pending permission prompt, working an in-flight tool call, and an empty
	# state is an untracked unknown - all need a deliberate --force.
	local state
	state=$(tmux display-message -p -t "$pane" '#{@agent_state}' 2>/dev/null)
	case "$state" in
	idle | done) ;;
	*)
		[ "$force" -eq 1 ] ||
			die 6 "refusing: pane $pane is '${state:-untracked}' (blocked = pending prompt, working = in-flight tool call); --force overrides"
		;;
	esac

	local pid
	pid=$(agent_foreground_pid_for_tty "$pane_tty" claude "$pane_pid")
	[ -n "$pid" ] || die 1 "no claude process in pane $pane (only Claude panes hibernate)"

	# Snapshot identity the way teleport/resurrect do: config dir from the live
	# env, session id from the per-PID registry (golden source), resolver
	# fallback; flags from the live argv with stale resume/continue stripped.
	local config_dir meta sid
	config_dir=$(claude_config_dir_for_pid "$pid")
	meta=$(claude_session_meta_for_pid "$pid" "${config_dir:-$HOME/.claude}")
	sid=$(jq -r '.sessionId // empty' <<<"$meta" 2>/dev/null)
	if [ -z "$sid" ]; then
		meta=$(claude_session_resolve_for_pid "$pid" "$pane" "$cwd" "$config_dir" 2>/dev/null) || meta=""
		if [ "$(jq -r '.status // empty' <<<"$meta" 2>/dev/null)" = resolved ]; then
			sid=$(jq -r '.sessionId // empty' <<<"$meta" 2>/dev/null)
		fi
	fi
	[ -n "$sid" ] ||
		die 1 "cannot resolve the Claude session for pane $pane - not hibernating (a blind --continue could resume the wrong conversation)"

	local saved_cmd flags_str
	saved_cmd=$(ps -o args= -p "$pid" 2>/dev/null)
	flags_str=$(resurrect_argv_claude_flags "$saved_cmd" 2>/dev/null) || flags_str=""

	local name rss_kb pgid
	name=$(tmux display-message -p -t "$pane" '#{@agent_name}' 2>/dev/null)
	rss_kb=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
	case "$rss_kb" in '' | *[!0-9]*) rss_kb=0 ;; esac
	pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')

	# Never hibernate the pane this very command runs in: the group kill would
	# take the script down before it parks the thawer.
	if [ -n "$pgid" ] && [ "$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')" = "$pgid" ]; then
		die 1 "refusing: this command is running inside pane $pane's process group; hibernate it from another pane"
	fi

	# Children of claude's process group die with the kill - name them first.
	if [ -n "$pgid" ]; then
		local kids
		kids=$(ps -ax -o pid=,pgid=,command= 2>/dev/null |
			awk -v g="$pgid" -v p="$pid" '$2 == g && $1 != p { print }')
		[ -n "$kids" ] &&
			printf 'agent-hibernate: processes in the claude process group (killed with it):\n%s\n' "$kids" >&2
	fi

	mkdir -p "$STATE_DIR" || die 1 "cannot create $STATE_DIR"
	# respawn-pane discards the visible screen (scrolled history survives), so
	# capture it now for park to re-print. Trailing blank lines are dropped:
	# capture-pane pads to the full pane height, and re-printing that padding
	# would scroll the content itself off the top of the parked pane.
	tmux capture-pane -e -p -t "$pane" 2>/dev/null |
		awk '{ buf = buf $0 "\n" } /[^[:space:]]/ { printf "%s", buf; buf = "" }' \
			>"$STATE_DIR/$sid.screen.txt" || true

	local flags_json tmp="$STATE_DIR/$sid.json.tmp.$$"
	flags_json=$(printf '%s' "$flags_str" | jq -R 'split(" ") | map(select(length > 0))')
	if ! jq -n \
		--arg sid "$sid" --arg pane "$pane" --arg key "$pane_key" \
		--arg cwd "$cwd" --arg config_dir "$config_dir" --arg name "$name" \
		--arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
		--argjson flags "$flags_json" --argjson rss "$rss_kb" \
		'{sessionId: $sid, pane: $pane, paneKey: $key, cwd: $cwd,
		  configDir: $config_dir, flags: $flags, name: $name,
		  hibernatedAt: $at, rssKb: $rss}' >"$tmp"; then
		rm -f "$tmp"
		die 1 "failed to write the hibernation record for $sid"
	fi
	mv -f "$tmp" "$STATE_DIR/$sid.json"

	AGENT_STATE_PANE="$pane" sh "$AGENT_STATE_SH" hibernated claude </dev/null || true

	# Both observed pane shapes must survive the kill: claude under a shell
	# (pane process = the shell, unaffected) and claude AS the pane process,
	# where its death would close the pane before park could be spawned.
	tmux set-option -p -t "$pane" remain-on-exit on 2>/dev/null || true

	# SIGTERM the process group, wait, SIGKILL fallback (sessions can ignore
	# SIGTERM - anthropics/claude-code#20572). respawn -k mops up any survivor.
	if [ -n "$pgid" ]; then
		kill -TERM -- "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
	else
		kill -TERM "$pid" 2>/dev/null || true
	fi
	local waited=0
	while kill -0 "$pid" 2>/dev/null; do
		if [ "$waited" -ge $((KILL_WAIT * 10)) ]; then
			[ -n "$pgid" ] && kill -KILL -- "-$pgid" 2>/dev/null
			kill -KILL "$pid" 2>/dev/null || true
			break
		fi
		sleep 0.1
		waited=$((waited + 1))
	done

	tmux respawn-pane -k -t "$pane" -c "$cwd" "$SELF" park ||
		die 1 "record written but respawn-pane failed; recover with: agent thaw"
	# Back to default close-on-exit now that park owns the pane.
	tmux set-option -pu -t "$pane" remain-on-exit 2>/dev/null || true

	printf 'hibernated %s%s in %s - freed ~%s MB\n' \
		"$sid" "${name:+ ($name)}" "$pane" "$((rss_kb / 1024))"
}

# --- park (runs inside the parked pane) -------------------------------------

cmd_park() {
	local pane="${TMUX_PANE:-}"
	[ -n "$pane" ] || die 1 "park runs inside a tmux pane (\$TMUX_PANE unset)"
	local key
	key=$(tmux display-message -p -t "$pane" \
		'#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null)

	# Resolution ladder: pane id -> pane key -> the session_ids.json hibernated
	# entry (written by the resurrect save pass; survives a server restart) ->
	# unique cwd. Anything unresolvable holds as an orphan the picker recovers.
	local recfile=""
	recfile=$(record_matching pane "$pane") ||
		recfile=$(record_matching paneKey "$key") || recfile=""
	if [ -z "$recfile" ] && [ -n "$key" ] && [ -f "$SESSION_FILE" ] &&
		command -v jq >/dev/null 2>&1; then
		local sid_hint
		sid_hint=$(jq -r --arg k "$key" \
			'.panes[$k] | select(.hibernated == true) | .claude // empty' \
			"$SESSION_FILE" 2>/dev/null)
		[ -n "$sid_hint" ] && [ -f "$STATE_DIR/$sid_hint.json" ] &&
			recfile="$STATE_DIR/$sid_hint.json"
	fi
	[ -n "$recfile" ] || recfile=$(record_for_cwd "$PWD") || recfile=""
	if [ -z "$recfile" ]; then
		printf 'orphaned hibernation: no record matches this pane\n'
		printf 'run "agent thaw" (or agent-hibernate.sh thaw) to recover it from the record store\n'
		while :; do read -rsn1 _ 2>/dev/null || sleep 60; done
	fi

	# Age from journal BEFORE re-journalling the hibernated state below.
	local age sid name rss_kb
	age=$(idle_age "$recfile")
	sid=$(jq -r '.sessionId' "$recfile" 2>/dev/null)
	name=$(jq -r '.name // empty' "$recfile" 2>/dev/null)
	rss_kb=$(jq -r '.rssKb // 0' "$recfile" 2>/dev/null)
	case "$rss_kb" in '' | *[!0-9]*) rss_kb=0 ;; esac

	# Re-address: after a restore both the pane id and possibly the key changed.
	local cur_pane cur_key
	cur_pane=$(jq -r '.pane // empty' "$recfile" 2>/dev/null)
	cur_key=$(jq -r '.paneKey // empty' "$recfile" 2>/dev/null)
	if [ "$cur_pane" != "$pane" ] || [ "$cur_key" != "${key:-$cur_key}" ]; then
		readdress "$recfile" "$pane" "${key:-$cur_key}"
	fi

	AGENT_STATE_PANE="$pane" sh "$AGENT_STATE_SH" hibernated claude </dev/null || true

	printf '\033[2J\033[H'
	[ -f "$STATE_DIR/$sid.screen.txt" ] && cat "$STATE_DIR/$sid.screen.txt"
	printf '\n\033[2mhibernated: %s (idle %s, freed %s MB) - Enter to thaw\033[0m\n' \
		"${name:-$sid}" "$age" "$((rss_kb / 1024))"

	local _key
	while :; do
		if IFS= read -rsn1 _key 2>/dev/null; then
			if [ -z "$_key" ]; then
				# Thaw runs server-side (run-shell -b), outside this pane's
				# process group: the respawn kills park mid-thaw otherwise,
				# before the record is cleaned up.
				tmux run-shell -b "'$SELF' thaw '$pane'"
				sleep 2 # let the respawn kill us; re-loop if the thaw failed
			fi
		else
			sleep 60 # no tty: hold quietly, stay recoverable via the picker
		fi
	done
}

# --- thaw --------------------------------------------------------------------

# thaw_record RECFILE — the one command builder both entry points (CLI and the
# parked pane's Enter) share: materialise the account, respawn (or open a new
# window for an orphan), clean up, hand the dot back to Claude's hooks.
thaw_record() {
	local recfile="$1"
	local sid cwd config_dir name rec_pane
	sid=$(jq -r '.sessionId // empty' "$recfile" 2>/dev/null)
	[ -n "$sid" ] || die 1 "malformed record: $recfile"
	cwd=$(jq -r '.cwd // empty' "$recfile" 2>/dev/null)
	config_dir=$(jq -r '.configDir // empty' "$recfile" 2>/dev/null)
	name=$(jq -r '.name // empty' "$recfile" 2>/dev/null)
	rec_pane=$(jq -r '.pane // empty' "$recfile" 2>/dev/null)
	local -a flags=()
	while IFS= read -r tok; do
		[ -n "$tok" ] && flags+=("$tok")
	done < <(jq -r '.flags[]?' "$recfile" 2>/dev/null)

	# Same refresh a ccp launch/restore does, so the resumed account inherits
	# the current shared settings/hooks. Idempotent; fails open.
	[ -n "$config_dir" ] && [ -x "$MATERIALISE" ] && "$MATERIALISE" "$config_dir" || true

	local -a envargs=()
	[ -n "$config_dir" ] && envargs=(-e "CLAUDE_CONFIG_DIR=$config_dir")

	local pane
	if pane_is_parked "$rec_pane"; then
		tmux respawn-pane -k -t "$rec_pane" -c "$cwd" "${envargs[@]}" \
			claude "${flags[@]}" --resume "$sid" ||
			die 1 "respawn-pane failed for $rec_pane"
		pane="$rec_pane"
	else
		# Orphan (pane gone, or its id was reused by something else after a
		# server restart): thaw into a fresh window in the recorded cwd.
		pane=$(tmux new-window -c "$cwd" "${envargs[@]}" -P -F '#{pane_id}' \
			claude "${flags[@]}" --resume "$sid") ||
			die 1 "new-window failed for orphan record $sid"
	fi

	rm -f "$recfile" "$STATE_DIR/$sid.screen.txt"
	# idle until Claude's own hooks take over.
	AGENT_STATE_PANE="$pane" sh "$AGENT_STATE_SH" idle claude </dev/null || true
	printf 'thawed %s%s in %s\n' "$sid" "${name:+ ($name)}" "$pane"
}

cmd_thaw() {
	command -v jq >/dev/null 2>&1 || die 1 "jq required"
	local target="${1:-}" recfile=""
	if [ -n "$target" ]; then
		case "$target" in
		%* | *:*)
			local pane key
			pane=$(tmux display-message -p -t "$target" '#{pane_id}' 2>/dev/null)
			[ -n "$pane" ] || die 3 "no such pane: $target"
			recfile=$(record_matching pane "$pane") || {
				key=$(tmux display-message -p -t "$pane" \
					'#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null)
				recfile=$(record_matching paneKey "$key") || recfile=""
			}
			[ -n "$recfile" ] || die 3 "no hibernation record for pane $target"
			;;
		*)
			[ -f "$STATE_DIR/$target.json" ] || die 3 "no hibernation record for '$target'"
			recfile="$STATE_DIR/$target.json"
			;;
		esac
	else
		recfile=$(pick_record) || return $?
	fi
	thaw_record "$recfile"
}

# pick_record — fzf over every record: parked panes plus orphans (records whose
# pane no longer exists - crash, killed window). Echoes the chosen record path.
pick_record() {
	local rows
	rows=$(cmd_list)
	if [ -z "$rows" ]; then
		echo "agent-hibernate: no hibernated sessions" >&2
		return 3
	fi
	command -v fzf >/dev/null 2>&1 ||
		die 2 "no target given and fzf not found; pick one from: agent-hibernate.sh list"
	local choice
	choice=$(printf '%s\n' "$rows" | fzf \
		--reverse --no-multi --info=hidden \
		--delimiter='\t' --with-nth=2.. \
		--prompt='thaw › ' \
		--header='status · name · idle · cwd · pane' \
		--preview "cat '$STATE_DIR'/{1}.screen.txt 2>/dev/null" \
		--preview-window=right:60%:wrap) || return 130
	local sid
	sid=$(printf '%s' "$choice" | cut -f1)
	[ -n "$sid" ] || return 130
	printf '%s\n' "$STATE_DIR/$sid.json"
}

# --- list --------------------------------------------------------------------

cmd_list() {
	command -v jq >/dev/null 2>&1 || die 1 "jq required"
	local rec sid pane name cwd status
	for rec in "$STATE_DIR"/*.json; do
		[ -f "$rec" ] || continue
		sid=$(jq -r '.sessionId // empty' "$rec" 2>/dev/null)
		[ -n "$sid" ] || continue
		pane=$(jq -r '.pane // empty' "$rec" 2>/dev/null)
		name=$(jq -r '.name // empty' "$rec" 2>/dev/null)
		cwd=$(jq -r '.cwd // empty' "$rec" 2>/dev/null)
		if pane_is_parked "$pane"; then status=parked; else status=orphan; fi
		printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
			"$sid" "$status" "${name:--}" "$(idle_age "$rec")" "$cwd" "${pane:--}"
	done
}

case "${1:-}" in
hibernate)
	shift
	cmd_hibernate "$@"
	;;
thaw)
	shift
	cmd_thaw "${1:-}"
	;;
park) cmd_park ;;
list) cmd_list ;;
*)
	echo "usage: agent-hibernate.sh <hibernate <pane> [--force] | thaw [pane|sid] | park | list>" >&2
	exit 2
	;;
esac
