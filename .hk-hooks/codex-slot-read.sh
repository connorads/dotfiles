#!/usr/bin/env bash
# codex-slot-read: only codex-windows.jq may name a Codex rate-limit SLOT.
#
# The invariant: no surface may name a Codex window a duration the payload does
# not support. `primary_window` / `secondary_window` are positions in the JSON,
# not window lengths - OpenAI moved the weekly figure into `primary_window` when
# it removed the 5h window (2026-07-12), so primary=5h mislabels it. The shared
# classifier .config/zsh/functions/codex-windows.jq turns those slots into a
# duration-sorted list once; every surface reads that list.
#
# Enforced because it was learned twice. codex-usage and the fancy dashboard
# adopted the classifier when it was written; usage-debug did not, kept reading
# the primary slot with a hardcoded `5h=` label, and printed "5h=14% reset in
# 6d 11h" for its whole life - a 5-hour window resetting in six and a half days,
# on the surface you reach for when the dashboard is what you cannot trust.
#
# Wired GLOBLESS in hk.pkl, and that is load-bearing: the case this exists for
# is a NEW surface file, which a path-scoped step cannot enumerate ahead of
# time. A glob matching nothing exits 0, so scoping it would fail open on the
# one shape it guards. Same reasoning as link-check.sh. Whole-tree is ~0.2s.
#
# Waiving a deliberate site: put `codex-slot-ok: <reason>` on the line or the
# one above it, one site at a time, saying why. One waiver exists today - the
# Spark extras (`additional_rate_limits`) in ai-usage apply the same duration
# rule inline because they are low-stakes and not the failure mode.
set -euo pipefail

# The classifier itself, the one file whose job is to read the slots.
OWNER='.config/zsh/functions/codex-windows.jq'

# Four kinds of file name a slot without ever classifying a window, so none of
# them can mislabel one:
#
#   - markdown, which documents the rule;
#   - the bats fixtures, which are raw API payloads - data to feed the
#     classifier, not code that classifies;
#   - this checker, which has to spell the names it forbids;
#   - hk.pkl, which wires this checker and carries its test fixtures.
#
# The last two are the rule talking about itself. Neither reads a Codex payload
# at all, so exempting them costs no coverage.
EXCLUDE_RE='(\.(md|markdown|mdx)$|^\.config/zsh/tests/|^\.hk-hooks/codex-slot-read\.sh$|^hk\.pkl$)'

WAIVER='codex-slot-ok'
SLOTS='primary_window|secondary_window'

# Which repo's tracked set to scan, most specific first. **A repo rooted at cwd
# owns cwd**, so its own tracked set is the answer even when GIT_DIR names
# another - that is what makes this checker's `hk test` sandbox testable at all
# (hk exports the dotfiles git-dir split into every step it spawns, so without
# this the sandbox's probe would never be the file scanned). It is also the right
# answer in CI, where cwd is the checkout root.
#
# Otherwise take the inherited env: locally that is $HOME via hk's exported
# GIT_DIR/GIT_WORK_TREE split. Run by hand from $HOME neither is set and $HOME
# holds no .git, so name the dotfiles git dir - the fallback link-check takes.
if [ -e .git ]; then
	git_cmd=(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git)
elif git rev-parse --git-dir >/dev/null 2>&1; then
	git_cmd=(git)
else
	git_cmd=(git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME")
	cd "$HOME"
fi

status=0

# One grep over the tracked set, then a per-hit look at the line above. Hits are
# a handful, so the second pass is cheap; reading every tracked file in the shell
# instead costs ~3.5s, which is not a price a pre-commit gate should charge.
while IFS= read -r hit; do
	file="${hit%%:*}"
	rest="${hit#*:}"
	lineno="${rest%%:*}"
	line="${rest#*:}"

	[ "$file" = "$OWNER" ] && continue
	# A zfn-link shim points back at a file already in this set; reporting it too
	# would name the same site twice, under a path nobody edits.
	[ -L "$file" ] && continue
	[[ "$file" =~ $EXCLUDE_RE ]] && continue
	[[ "$line" == *"$WAIVER"* ]] && continue
	[ "$lineno" -gt 1 ] &&
		[[ "$(sed -n "$((lineno - 1))p" "$file")" == *"$WAIVER"* ]] &&
		continue

	printf '%s:%d: reads a Codex rate-limit slot positionally\n' "$file" "$lineno" >&2
	printf '  %s\n' "$line" >&2
	status=1
done < <("${git_cmd[@]}" grep -nIE "$SLOTS" -- . || true)

if [ "$status" -ne 0 ]; then
	cat >&2 <<-MSG

		A window's length lives in the payload's limit_window_seconds, never in
		which slot it arrived in. Read $OWNER
		instead - it emits [{seconds, used_percent, reset_after_seconds, reset_at}],
		shortest window first, with seconds:0 meaning the payload gave no length.

		If a site genuinely must name a slot, waive it with a
		\`$WAIVER: <reason>\` comment on that line or the one above.
	MSG
fi

exit "$status"
