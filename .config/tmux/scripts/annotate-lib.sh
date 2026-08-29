#!/bin/sh
# annotate-lib.sh — shared vocabulary for the annotate subsystem. Sourced
# (never executed) so the status pill and any later surface speak one language
# — IDLE | SPOOLED | DRAFTING, one colour/glyph/token set — defined once here.
# Mirrors vox-lib.sh / caffeine-lib.sh / mem-lib.sh's one-lib-many-surfaces role.
#
# What it reports: `annotate` is a spool with more than one slot. copy-mode `a`
# stashes an excerpt with no comment; prefix + Alt+e renders the spool into a
# markdown draft, opens it in $EDITOR, and delivers it to the pane the excerpts
# came from. The pill exists so a stashed excerpt or an unsent draft cannot be
# silently forgotten — both are states you leave the machine in.
#
# State comes from `annotate count --json`, i.e. from the event log's own fold,
# rather than being recomputed here. Duplicating the fold in sh is exactly how
# a status pill goes stale against the store it claims to report. One bun spawn
# costs ~26 ms and status-interval is 15 s, so the freshness is free.
#
# Function-locals are _underscore-prefixed and always assigned before use so
# `set -u` callers (status-right.sh) are neither clobbered nor tripped. Colours
# are bare 6-hex (no leading #), `#`-prefixed at the call site, matching
# vox_state_colour / mem_state_colour.

# The CLI. Env-overridable so bats can point it at a stub without a real spool.
ANNOTATE_BIN=${ANNOTATE_BIN:-$HOME/.local/bin/annotate}

# The event log, only ever tested for existence here — never parsed. A log that
# does not exist, or is zero bytes, folds to empty state by definition, so the
# pill can answer IDLE without spawning anything.
#
# This is the difference between the pill costing nothing and costing a bun
# spawn (~26 ms) on every status repaint in every attached client, forever, on
# a machine that has never used annotate. It is the base case of the fold, not
# a second implementation of it: the moment the log has any content at all,
# this defers to the CLI.
ANNOTATE_LOG=${ANNOTATE_LOG:-${ANNOTATE_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/agents}/annotate.jsonl}

# SPOOLED pill colour — catppuccin subtext0, the muted data-pill foreground
# shared with disk/git and with vox's RECORDING. Excerpts waiting are ambient
# chrome, not an alarm: the pill is visible during screen shares, and nothing
# is at risk. Clears WCAG AA on #45475a.
ANNOTATE_COLOUR=a6adc8

# DRAFTING pill colour — catppuccin blue, the SAME blue the agent dots use for
# "finished, and you have not looked yet", and that vox uses for READY. Unread
# is one idea across this config: a blue pill always means there is writing of
# yours waiting on you.
ANNOTATE_DRAFT_COLOUR=89b4fa

# SPOOLED glyph — a pencil. Neutral east-asian width (narrower than the ◆/●
# already shipped), no emoji presentation form, so it cannot double-width the
# rail — the trap caffeine-lib documents for ☕. Collides with no existing
# vocabulary: mem ⬡⊟⊠, resurrect ⟳⚠, agent dots ◆◐●○·, caffeine ☼, vox ~≈✓!.
ANNOTATE_GLYPH="${ANNOTATE_GLYPH:-✎}"

# DRAFTING glyph — a dotted circle: the same pencil idea "in progress", and
# visually distinct from the pencil on a colour clash. Also Neutral width.
ANNOTATE_DRAFT_GLYPH="${ANNOTATE_DRAFT_GLYPH:-◍}"

# annotate_read — load `annotate count --json` into _annotate_spool /
# _annotate_draft. Returns 1 (fields zeroed) when the CLI cannot answer, so a
# missing bun or an unreadable store reads IDLE and the pill self-hides rather
# than printing an error onto the status line.
annotate_read() {
	_annotate_spool=0
	_annotate_draft=false
	# No log, or an empty one, is empty state - answer without spawning.
	[ -s "$ANNOTATE_LOG" ] || return 1
	[ -x "$ANNOTATE_BIN" ] || return 1
	_annotate_json=$("$ANNOTATE_BIN" count --json 2>/dev/null) || return 1
	[ -n "$_annotate_json" ] || return 1
	# Deliberately not jq: this runs on every status repaint, and the shape is
	# two scalars this lib itself defines. A missing field leaves the zeroed
	# default rather than failing.
	case "$_annotate_json" in
	*'"spool":'*) _annotate_spool=${_annotate_json#*\"spool\":} ;;
	*) return 1 ;;
	esac
	_annotate_spool=${_annotate_spool%%,*}
	_annotate_spool=${_annotate_spool%%\}*}
	case "$_annotate_spool" in
	'' | *[!0-9]*) _annotate_spool=0 ;;
	esac
	case "$_annotate_json" in
	*'"draft":true'*) _annotate_draft=true ;;
	*) _annotate_draft=false ;;
	esac
	return 0
}

# annotate_state_of SPOOL DRAFT — DRAFTING > SPOOLED > IDLE, "worst first" like
# vox_state and the agent dots' rank. DRAFTING outranks SPOOLED because an
# unsent draft holds writing you did; a spooled excerpt is only a passage you
# pointed at.
#
# Pure over its two arguments, so the whole state table is testable without a
# spool, and so a caller that has already read the store pays for one spawn
# rather than one per question.
annotate_state_of() {
	if [ "$2" = true ]; then
		echo DRAFTING
	elif [ "${1:-0}" -gt 0 ] 2>/dev/null; then
		echo SPOOLED
	else
		echo IDLE
	fi
}

# annotate_state — the state, reading the store itself. For callers that want
# one answer; the status segment uses annotate_read + annotate_state_of so a
# repaint spawns the CLI once.
annotate_state() {
	annotate_read || {
		echo IDLE
		return
	}
	annotate_state_of "$_annotate_spool" "$_annotate_draft"
}

# annotate_state_colour STATE — bare 6-hex pill colour. IDLE self-hides, so its
# colour is never rendered; the signature stays parallel to the other libs.
annotate_state_colour() {
	case "$1" in
	DRAFTING) printf '%s' "$ANNOTATE_DRAFT_COLOUR" ;;
	*) printf '%s' "$ANNOTATE_COLOUR" ;;
	esac
}

# annotate_state_glyph STATE — the pill glyph. Parallel to the other libs.
annotate_state_glyph() {
	case "$1" in
	DRAFTING) printf '%s' "$ANNOTATE_DRAFT_GLYPH" ;;
	*) printf '%s' "$ANNOTATE_GLYPH" ;;
	esac
}

# annotate_token — figure-slot content: how many excerpts are waiting. Shown in
# both visible states, because a draft that has excerpts appended below the
# comments still has that many to answer for.
annotate_token() {
	annotate_read || {
		printf '0'
		return
	}
	printf '%s' "$_annotate_spool"
}

# annotate_pill — "STATE COUNT" on one line, from a single read of the store.
#
# This is what the status segment consumes. Everything the pill needs comes
# back in one string, so a repaint spawns the CLI once and the caller never
# reaches for this lib's underscore locals — which it cannot see anyway, and
# which shellcheck rightly flags when it tries.
annotate_pill() {
	annotate_read || {
		printf 'IDLE 0'
		return
	}
	printf '%s %s' \
		"$(annotate_state_of "$_annotate_spool" "$_annotate_draft")" \
		"$_annotate_spool"
}
