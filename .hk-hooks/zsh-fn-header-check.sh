#!/usr/bin/env bash
# zsh-fn-header-check: enforce the shell-function conventions for files under
# .config/zsh/functions/ (see "Shell Function Conventions" in ~/AGENTS.md):
#   1. a `# <name>: <purpose>` header on line 1 (line 2 for dual-mode files)
#   2. `#!/usr/bin/env zsh` shebang XOR a `# zsh-only: <reason>` marker in the
#      first 5 lines - every function is either a dual-mode PATH command or
#      self-declares why it must stay autoload-only.
# Quiet on success; names each offending file on stderr and exits 1 to block.
set -euo pipefail

fail=0
err() {
	echo "zsh-fn-header: $1: $2" >&2
	fail=1
}

for f in "$@"; do
	case $f in
	*.jq) continue ;; # non-zsh helpers carry their own extension
	esac
	[[ -f $f ]] || continue # deleted paths can still be in the staged list

	name=$(basename "$f")
	line1="" line2="" has_marker=0 i=0
	while IFS= read -r line || [[ -n $line ]]; do
		i=$((i + 1))
		((i == 1)) && line1=$line
		((i == 2)) && line2=$line
		[[ $line == '# zsh-only: '?* ]] && has_marker=1
		((i >= 5)) && break
	done <"$f"

	if [[ $line1 == '#!/usr/bin/env zsh' ]]; then
		dual=1 header=$line2
	else
		dual=0 header=$line1
	fi

	if [[ $header != "# ${name}: "?* ]]; then
		err "$f" "line $((dual + 1)) must be '# ${name}: <purpose>'"
	fi

	if ((dual)) && ((has_marker)); then
		err "$f" "dual-mode (shebang) files must not carry a '# zsh-only:' marker"
	elif ((!dual)) && ((!has_marker)); then
		err "$f" "add '#!/usr/bin/env zsh' (dual-mode) or a '# zsh-only: <reason>' marker"
	fi
done
exit $fail
