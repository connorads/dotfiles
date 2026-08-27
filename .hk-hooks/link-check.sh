#!/usr/bin/env bash
# link-check: lychee over every tracked markdown file, offline.
#
# Wired GLOBLESS in hk.pkl, deliberately. Link rot is caused by deleting or
# moving a target, not by editing the file that holds the link - and a staged
# deletion resolves to zero files, so a globbed step does not fire at all and
# would silently miss the one case it exists for. Owning the file list here
# instead is the same shape as nix-eval.sh.
#
# --offline: relative paths and heading anchors are resolved against the tree,
# no network call at commit time (the zizmor step's posture). Whole-tree is
# ~0.2s over ~335 files, so there is nothing to scope.
#
# Relative paths on purpose: hk runs steps from the work-tree root, which is
# $HOME locally but the checkout dir in CI.
set -euo pipefail

# Whether a tool can actually RUN, not merely resolve. `command -v` is not
# enough: mise plants a shim on PATH for every tool in its registry, so the name
# resolves on a machine where no version is set - and the shim then exits 1
# ("No version is set for shim"), turning this warn-and-skip into a hard failure.
runs() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1; }

if ! runs lychee --version; then
	echo "link-check: lychee absent; skipping (run 'mise install lychee')" >&2
	exit 0
fi

# Vendored mirrors carry upstream's own broken links - 15 of them - which are
# not ours to fix and would come back on every `skills update`.
#
# src/dotfiles-docs is Astro: its internal links are extensionless routes
# (/trust/supply-chain/) that no filesystem resolver can follow, so lychee calls
# all 40 broken while every target exists, and --root-dir does not help.
# starlight-links-validator gates those at build time instead, where the route
# table is known.
EXCLUDE_RE='^(\.config/skills/vendor|\.codex/skills|src/dotfiles-docs)/'

# Under hk there is always a work-tree to discover: $HOME via the exported
# GIT_DIR/GIT_WORK_TREE split locally, the checkout in CI. Run by hand from
# $HOME neither is set and $HOME holds no .git, so name the dotfiles git dir -
# the same fallback gate-coverage.py takes.
if git rev-parse --git-dir >/dev/null 2>&1; then
	git_cmd=(git)
else
	git_cmd=(git --git-dir="$HOME/git/dotfiles" --work-tree="$HOME")
	cd "$HOME"
fi

files=()
while IFS= read -r f; do
	files+=("$f")
done < <("${git_cmd[@]}" ls-files -- '*.md' '*.markdown' '*.mdx' | grep -vE "$EXCLUDE_RE" || true)

if [ ${#files[@]} -eq 0 ]; then
	exit 0
fi

exec lychee --offline --no-progress -- "${files[@]}"
