#!/usr/bin/env bash
# check.sh: pre-ship checks for an agent skill directory.
# Usage: scripts/check.sh <skill-dir>
# Spec violations are errors (exit 1); hygiene findings are warnings (exit 0).
set -euo pipefail

if [[ $# -ne 1 || ! -d ${1:-} ]]; then
	echo "usage: check.sh <skill-dir>" >&2
	exit 2
fi
dir=${1%/}
errors=0
warnings=0

err() {
	echo "ERROR:   $1"
	errors=$((errors + 1))
}
warn() {
	echo "warning: $1"
	warnings=$((warnings + 1))
}

skill_md="$dir/SKILL.md"
if [[ ! -f $skill_md ]]; then
	err "no SKILL.md — not a loadable skill"
	echo "1 error(s)"
	exit 1
fi

# --- Frontmatter ------------------------------------------------------------
if [[ "$(head -n 1 "$skill_md")" != "---" ]]; then
	err "SKILL.md does not open with '---' frontmatter delimiter"
fi

# Frontmatter block = lines between the first '---' and the next '---'.
fm=$(awk 'NR==1 && /^---$/ {inside=1; next} inside && /^---$/ {exit} inside {print}' "$skill_md")
if [[ -z $fm ]]; then
	err "frontmatter block is empty or unclosed"
fi

# Closed field set per the agentskills spec: unknown top-level keys are invalid.
allowed="name description license compatibility metadata allowed-tools"
while IFS= read -r key; do
	[[ -z $key ]] && continue
	if ! grep -qw -- "$key" <<<"$allowed"; then
		err "unknown top-level frontmatter key '$key' (allowed: $allowed; custom data goes under metadata)"
	fi
done < <(awk '/^[A-Za-z][A-Za-z-]*:/ {sub(/:.*/,""); print}' <<<"$fm")

name=$(awk '/^name:/ {sub(/^name:[ \t]*/,""); gsub(/^["'"'"']|["'"'"']$/,""); print; exit}' <<<"$fm")
if [[ -z $name ]]; then
	err "missing required frontmatter field: name"
else
	[[ $name == "$(basename "$dir")" ]] || err "name '$name' != directory name '$(basename "$dir")'"
	[[ $name =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || err "name '$name' violates naming rules (lowercase alnum + single hyphens)"
	((${#name} <= 64)) || err "name exceeds 64 characters"
fi

# Description: from 'description:' up to the next top-level key. 1-1024 chars.
desc=$(awk '/^description:/ {inside=1} inside && /^[A-Za-z][A-Za-z-]*:/ && !/^description:/ {exit} inside {print}' <<<"$fm" |
	sed -E 's/^description:[ \t]*//; s/^[ \t]+//; s/^[>|][+-]?$//' | tr '\n' ' ')
desc_len=$(printf '%s' "$desc" | sed -E 's/[ \t]+/ /g; s/^ //; s/ $//' | wc -c | tr -d ' ')
if ((desc_len == 0)); then
	err "missing or empty required frontmatter field: description"
elif ((desc_len > 1024)); then
	err "description is $desc_len chars (max 1024)"
fi

# --- Hygiene ----------------------------------------------------------------
# Local state that should never ship inside a skill.
while IFS= read -r -d '' f; do
	warn "shipped cache/artifact: ${f#"$dir"/}"
done < <(find "$dir" \( -name __pycache__ -o -name .rumdl_cache -o -name node_modules \
	-o -name .DS_Store -o -name '*.pyc' \) -print0)

# Orphans: bundled files never mentioned in SKILL.md (matched by basename;
# heuristic, so a warning). LICENSE files and evals/ are conventional exceptions.
while IFS= read -r -d '' f; do
	rel=${f#./}
	base=$(basename "$rel")
	case $rel in
	SKILL.md | LICENSE* | licence* | evals/*) continue ;;
	esac
	grep -qF "$base" "$skill_md" || warn "possible orphan: $rel is never referenced from SKILL.md"
done < <(cd "$dir" && find . -type f ! -path '*/.*' -print0)

# Long references need a table of contents: partial reads of a long file
# silently lose scope. 300 lines matches the guidance in spec-and-packaging.md.
while IFS= read -r -d '' f; do
	lines=$(wc -l <"$f" | tr -d ' ')
	if ((lines > 300)) && ! head -40 "$f" | grep -qiE '^#+ +(contents|table of contents)'; then
		warn "${f#"$dir"/} is $lines lines with no Contents section in its first 40 lines"
	fi
done < <(find "$dir" -name '*.md' ! -name SKILL.md -print0)

# Doc-rot phrasing: change-history written as standing prose.
while IFS= read -r hit; do
	warn "possible doc-rot phrasing: $hit"
done < <(grep -rnEi '\b(no longer|previously|used to|recently (added|changed|moved)|as of (19|20)[0-9]{2})\b' \
	--include='*.md' "$dir" | sed "s|^$dir/||" || true)

# --- Authoritative validator, when available ---------------------------------
if command -v skills-ref >/dev/null 2>&1; then
	skills-ref validate "$dir" || err "skills-ref validate failed (see output above)"
else
	echo "note: skills-ref not installed; skipped the reference validator"
fi

echo "$errors error(s), $warnings warning(s)"
((errors == 0)) || exit 1
