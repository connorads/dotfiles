#!/usr/bin/env bash
# py-tests-dir: run one flat Python script dir's pytest suite under uv.
# The sibling of py-typecheck.sh, and the counterpart to py-tests.sh: that one
# discovers a project from its pyproject.toml, which a script dir does not have,
# so the dir is named instead. `--with pytest` is the same invocation
# `mise run py-checks` uses for these dirs.
# Skips gracefully (warn, exit 0) when uv is not on PATH, so fresh/offline
# machines aren't blocked; the gate never bricks a commit it can't evaluate.
set -euo pipefail

# Suites must not inherit the bare-repo GIT_DIR/GIT_WORK_TREE the hook wrappers
# export: a bare `git` in a test would target the dotfiles repo.
unset GIT_DIR GIT_WORK_TREE

# Whether a tool can actually RUN, not merely resolve. `command -v` is not
# enough: mise plants a shim on PATH for every tool in its registry, so the name
# resolves on a machine where no version is set - and the shim then exits 1
# ("No version is set for shim"), turning this warn-and-skip into a hard failure.
runs() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1; }

root="$1"
cd "$HOME/$root" 2>/dev/null || {
	echo "py-tests-dir: $root missing, skipping" >&2
	exit 0
}
if ! runs uv --version; then
	echo "py-tests-dir: skipping $root (uv absent; run 'mise install')" >&2
	exit 0
fi
echo "py-tests-dir: pytest ($root)"
exec uv run --with pytest python -m pytest -q
