#!/usr/bin/env bash
# tools-tsv-lint: every non-blank row of tools.tsv must be `label<TAB>command`.
# The prefix+T popup parser (tools-popup.sh) lists column 1 in fzf and runs
# everything after the FIRST tab, so a tab-less row shows up in the picker but
# silently runs nothing when chosen. Embedded tabs in the command are legal -
# assert >= 2 fields, never == 2. Path is cwd-relative (work-tree root locally,
# checkout dir in CI), matching the sibling checkers.
set -euo pipefail

exec awk -F'\t' '
	!/^[[:space:]]*$/ && NF < 2 {
		printf ".config/tmux/tools.tsv:%d: row has no TAB separator (label<TAB>command): %s\n", NR, $0
		bad = 1
	}
	END { exit bad }
' .config/tmux/tools.tsv
