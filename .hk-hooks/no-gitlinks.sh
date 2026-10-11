#!/usr/bin/env bash
# no-gitlinks: the work tree is $HOME, so it holds other git checkouts, and an
# add that reaches one records a mode-160000 gitlink - a bare commit pointer
# with no content and no .gitmodules entry. Every other host checks it out as
# an empty dir. Ignore the checkout or move it under ~/git instead.
#
# Reads the whole index: one ls-files call, so there is nothing to scope.
set -euo pipefail

gitlinks=$(git ls-files --stage | awk -F '\t' '$1 ~ /^160000 / {print $2}')
[[ -z $gitlinks ]] && exit 0

echo "$gitlinks"
echo "no-gitlinks: nested git checkouts are staged as gitlinks - unstage, then ignore them or move them under ~/git" >&2
exit 1
