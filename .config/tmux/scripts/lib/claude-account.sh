#!/usr/bin/env bash
# claude-account.sh: cross-account fork helpers for the Claude branch menu.
# Sourced (never executed), like agent-session.sh / resurrect-lib.sh, so the
# pure logic unit-tests directly.
#
# Claude accounts are isolated by CLAUDE_CONFIG_DIR (the ccp profile system:
# ~/.claude default vs ~/.claude-profiles/code/<name>). Each config dir owns its
# own projects/<slug>/<sid>.jsonl transcript tree; the transcript carries no
# auth. So "continue this chat under a different account" reduces to copying the
# transcript into the target account's projects/ tree, then forking it there
# with native --fork-session (which mints a fresh id and leaves the origin
# untouched). These helpers do the slug maths, candidate listing, and the copy.

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

# relocate_transcript <src_config_dir> <dst_config_dir> <cwd> <sid>
# Copy the source account's live transcript into the target account's projects/
# tree so --fork-session can read it there. Empty dirs normalise to $HOME/.claude.
# Fails loudly (non-zero, message on stderr, no write) if the source transcript
# is absent. Prints the destination path on success.
relocate_transcript() {
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
		printf 'relocate_transcript: source transcript not found: %s\n' "$src_file" >&2
		return 1
	fi

	local dst_dir="$dst_config_dir/projects/$slug"
	local dst_file="$dst_dir/$sid.jsonl"
	mkdir -p "$dst_dir"
	cp "$src_file" "$dst_file"
	printf '%s\n' "$dst_file"
}
