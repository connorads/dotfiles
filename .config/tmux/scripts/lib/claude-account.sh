#!/usr/bin/env bash
# claude-account.sh: cross-account fork helpers for the Claude branch menu.
# Sourced (never executed), like agent-session.sh / resurrect-lib.sh, so the
# pure logic unit-tests directly.
#
# Claude accounts are isolated by CLAUDE_CONFIG_DIR (the ccp profile system:
# ~/.claude default vs ~/.claude-profiles/code/<name>). Each config dir owns its
# own projects/<slug>/<sid>.jsonl transcript tree; the transcript carries no
# auth. So "continue this chat under a different account" reduces to copying the
# session into the target account's projects/ tree, stage any active plan, then
# fork it there with native --fork-session (which mints a fresh id and leaves
# the origin untouched). These helpers do the slug maths, candidate listing,
# and staging.

# Under bash this needs bash >= 5, so the entry point that sources it must carry
# the re-exec preamble. Gated on BASH_VERSION because zsh callers source this
# too (agent-teleport, claude-session-adopt) and are unaffected.
if [ -n "${BASH_VERSION:-}" ] && [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	printf '%s: requires bash >= 5 (got %s)\n' "claude-account.sh" "$BASH_VERSION" >&2
	# shellcheck disable=SC2317  # reachable: this file is sourced, not executed
	return 1 2>/dev/null || exit 1
fi

# claude_account_slug <cwd>
# Claude slugs EVERY non-alphanumeric char (dots included) to "-" when it names
# a project dir. Mirrors project_slug in claude-session-resolve.py exactly - a
# bare "/" replace would miss dotted paths like ~/.trees/x.
claude_account_slug() {
	local cwd="${1:-}"
	printf '%s' "${cwd//[^A-Za-z0-9]/-}"
}

# account_candidates <source_config_dir>
# Emit "label<TAB>config_dir" for every fork target, one per line: the default
# account plus each ~/.claude-profiles/code/* profile, EXCLUDING the source
# account (you cannot fork onto yourself). An empty source_config_dir means the
# default account, normalised to $HOME/.claude before comparing. config_dir is
# always the real dir - for `default` that is $HOME/.claude.
account_candidates() {
	local source_config_dir="${1:-}"
	[ -n "$source_config_dir" ] || source_config_dir="$HOME/.claude"

	local default_dir="$HOME/.claude"
	[ "$default_dir" = "$source_config_dir" ] || printf 'default\t%s\n' "$default_dir"

	local profiles_dir="$HOME/.claude-profiles/code"
	[ -d "$profiles_dir" ] || return 0

	local dir name
	for dir in "$profiles_dir"/*/; do
		[ -d "$dir" ] || continue
		dir="${dir%/}"
		[ "$dir" = "$source_config_dir" ] && continue
		name="${dir##*/}"
		printf '%s\t%s\n' "$name" "$dir"
	done
}

# stage_session_for_fork <src_config_dir> <dst_config_dir> <cwd> <sid>
# Copy the source account's live transcript into the target account's projects/
# tree and stage its active plan under the target account's plans/ directory so
# --fork-session can clone the sidecar. Empty dirs normalise to $HOME/.claude.
# Prints the destination transcript path. Returns 1 when transcript copying
# fails, or 2 when the transcript was copied but its plan could not be staged.
stage_session_for_fork() {
	local src_config_dir="${1:-}"
	local dst_config_dir="${2:-}"
	local cwd="${3:-}"
	local sid="${4:-}"
	[ -n "$src_config_dir" ] || src_config_dir="$HOME/.claude"
	[ -n "$dst_config_dir" ] || dst_config_dir="$HOME/.claude"

	local slug
	slug=$(claude_account_slug "$cwd")

	local src_file="$src_config_dir/projects/$slug/$sid.jsonl"
	if [ ! -f "$src_file" ]; then
		printf 'stage_session_for_fork: source transcript not found: %s\n' "$src_file" >&2
		return 1
	fi

	local dst_dir="$dst_config_dir/projects/$slug"
	local dst_file="$dst_dir/$sid.jsonl"
	local dst_transcript_existed=0
	[ -f "$dst_file" ] && dst_transcript_existed=1
	if ! mkdir -p "$dst_dir"; then
		printf 'stage_session_for_fork: could not create target projects directory: %s\n' "$dst_dir" >&2
		return 1
	fi
	if ! cp "$src_file" "$dst_file"; then
		printf 'stage_session_for_fork: could not copy transcript to: %s\n' "$dst_file" >&2
		return 1
	fi
	printf '%s\n' "$dst_file"

	local plan_file
	if ! plan_file=$(jq -rs '
		[.[] | select(.attachment?.type? == "plan_mode")]
		| if length == 0 then ""
		  elif (.[-1].attachment.planFilePath | type) == "string"
		  then .[-1].attachment.planFilePath
		  else error("planFilePath is not a string")
		  end
	' "$src_file"); then
		printf 'stage_session_for_fork: could not parse plan attachment in: %s\n' "$src_file" >&2
		return 2
	fi
	[ -n "$plan_file" ] || return 0

	local src_plans_dir="$src_config_dir/plans"
	if [ "$(dirname "$plan_file")" != "$src_plans_dir" ] || [ -L "$plan_file" ]; then
		printf 'stage_session_for_fork: unsafe source plan path: %s\n' "$plan_file" >&2
		return 2
	fi
	if [ ! -f "$plan_file" ]; then
		printf 'stage_session_for_fork: source plan not found: %s\n' "$plan_file" >&2
		return 2
	fi
	if [ ! -s "$plan_file" ]; then
		printf 'stage_session_for_fork: source plan is empty: %s\n' "$plan_file" >&2
		return 2
	fi

	local dst_plans_dir="$dst_config_dir/plans"
	if ! mkdir -p "$dst_plans_dir"; then
		printf 'stage_session_for_fork: could not create target plans directory: %s\n' "$dst_plans_dir" >&2
		return 2
	fi

	local plan_name="${plan_file##*/}"
	local dst_plan="$dst_plans_dir/$plan_name"
	if [ -e "$dst_plan" ]; then
		if cmp -s "$plan_file" "$dst_plan"; then
			return 0
		fi
		if [ "$dst_transcript_existed" -eq 0 ]; then
			printf 'stage_session_for_fork: target plan already exists and belongs to another session: %s\n' "$dst_plan" >&2
			return 2
		fi
	fi

	local tmp_plan
	if ! tmp_plan=$(mktemp "$dst_plans_dir/.${plan_name}.tmp.XXXXXX"); then
		printf 'stage_session_for_fork: could not create temporary target plan in: %s\n' "$dst_plans_dir" >&2
		return 2
	fi
	if ! cp "$plan_file" "$tmp_plan"; then
		rm -f "$tmp_plan"
		printf 'stage_session_for_fork: could not copy plan to: %s\n' "$dst_plan" >&2
		return 2
	fi
	if ! mv -f "$tmp_plan" "$dst_plan"; then
		rm -f "$tmp_plan"
		printf 'stage_session_for_fork: could not install target plan: %s\n' "$dst_plan" >&2
		return 2
	fi
}
