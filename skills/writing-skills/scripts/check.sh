#!/usr/bin/env bash
# check.sh: pre-ship checks for an agent skill directory.
# Usage: scripts/check.sh <skill-dir>
# Spec violations are errors (exit 1); hygiene findings are warnings (exit 0).
set -euo pipefail

if [[ $# -ne 1 || ! -d ${1:-} ]]; then
	echo "usage: check.sh <skill-dir>" >&2
	exit 2
fi
dir=$(cd "$1" && pwd -P)
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
fm=""
fm_valid=1
if [[ "$(head -n 1 "$skill_md")" != "---" ]]; then
	err "SKILL.md does not open with '---' frontmatter delimiter"
	fm_valid=0
else
	# Frontmatter block = lines between the first '---' and the next '---'.
	fm_end=$(awk 'NR > 1 && /^---$/ {print NR; exit}' "$skill_md")
	if [[ -z $fm_end ]]; then
		err "frontmatter block is unclosed (missing closing '---')"
		fm_valid=0
	else
		fm=$(sed -n "2,$((fm_end - 1))p" "$skill_md")
	fi
fi

if ((fm_valid)) && [[ -z $fm ]]; then
	err "frontmatter block is empty or unclosed"
fi

# Closed field set per the agentskills spec: unknown top-level keys are invalid.
# Extraction is broad (underscore/digit keys too) so nothing slips past unseen;
# the allowlist match is exact so 'tools' never passes as a prefix of
# 'allowed-tools'. disable-model-invocation is the one accepted client
# extension: clients that lack it ignore it, and a hand-picked skill needs it
# to stay out of the model's listing (see spec-and-packaging.md).
allowed="name description license compatibility metadata allowed-tools disable-model-invocation"
if ((fm_valid)); then
	while IFS= read -r key; do
		[[ -z $key ]] && continue
		if ! grep -qFx -- "$key" <<<"${allowed// /$'\n'}"; then
			err "unknown top-level frontmatter key '$key' (allowed: $allowed; custom data goes under metadata)"
		fi
	done < <(awk '/^[A-Za-z][A-Za-z0-9_-]*:/ {sub(/:.*/,""); print}' <<<"$fm")
fi

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
desc=$(printf '%s' "$desc" | sed -E 's/[ \t]+/ /g; s/^ //; s/ $//')
desc_len=$(printf '%s' "$desc" | wc -c | tr -d ' ')
if ((desc_len == 0)); then
	err "missing or empty required frontmatter field: description"
elif ((desc_len > 1024)); then
	err "description is $desc_len chars (max 1024)"
fi

tag_re='</?[A-Za-z][A-Za-z0-9-]*([[:space:]][^>]*)?/?>'
if [[ -n $name && $name =~ $tag_re ]]; then
	err "name contains XML-like tag syntax (not allowed)"
fi
if [[ -n $desc && $desc =~ $tag_re ]]; then
	err "description contains XML-like tag syntax (not allowed)"
fi

# --- Hygiene ----------------------------------------------------------------
# Long bodies carry reference material into every triggered session. 500 lines
# is the skill body cap from the authoring guidance; warn so authors can move
# stack/provider details into routed references.
skill_lines=$(wc -l <"$skill_md" | tr -d ' ')
if ((skill_lines > 500)); then
	warn "SKILL.md is $skill_lines lines (recommended max 500; move reference-shaped detail into references/)"
fi

# The files the skill ships, relative to $dir. Inside a git work-tree that is
# tracked plus untracked-but-unignored files, so gitignored local state
# (__pycache__, tool caches) is never reported as shipped. `git -C` honours
# GIT_DIR/GIT_WORK_TREE, which covers a split git-dir such as a dotfiles
# work-tree. Outside git, every file. evals/fixtures/ holds deliberately
# broken skills, so no scan below sees it.
files=()
if [[ $(git -C "$dir" rev-parse --is-inside-work-tree 2>/dev/null) == true ]]; then
	lister=(git -C "$dir" ls-files -z --cached --others --exclude-standard)
else
	lister=(find . -type f -print0)
fi
while IFS= read -r -d '' f; do
	rel=${f#./}
	[[ $rel == evals/fixtures/* ]] && continue
	# ls-files --cached still lists a tracked file deleted from the work-tree.
	[[ -f $dir/$rel ]] && files+=("$rel")
done < <(cd "$dir" && "${lister[@]}")

# Local state that should never ship inside a skill. One warning per cache
# directory, not per file inside it.
reported=" "
for rel in ${files[@]+"${files[@]}"}; do
	prefix=""
	IFS=/ read -ra parts <<<"$rel"
	for part in "${parts[@]}"; do
		prefix=${prefix:+$prefix/}$part
		case $part in
		__pycache__ | .rumdl_cache | node_modules | .DS_Store | *.pyc)
			if [[ $reported != *" $prefix "* ]]; then
				warn "shipped cache/artifact: $prefix"
				reported+="$prefix "
			fi
			break
			;;
		esac
	done
done

# Orphans: bundled files never mentioned in SKILL.md (matched by basename;
# heuristic, so a warning). LICENSE files, evals/ and tests/ are conventional
# exceptions: tests exercise the skill's scripts, the agent never loads them.
for rel in ${files[@]+"${files[@]}"}; do
	case $rel in
	SKILL.md | LICENSE* | licence* | evals/* | tests/* | .* | */.*) continue ;;
	esac
	grep -qF "$(basename "$rel")" "$skill_md" || warn "possible orphan: $rel is never referenced from SKILL.md"
done

# Long references need a table of contents: partial reads of a long file
# silently lose scope. 300 lines matches the guidance in spec-and-packaging.md.
for rel in ${files[@]+"${files[@]}"}; do
	[[ $rel == *.md && $(basename "$rel") != SKILL.md ]] || continue
	lines=$(wc -l <"$dir/$rel" | tr -d ' ')
	if ((lines > 300)) && ! head -40 "$dir/$rel" | grep -qiE '^#+ +(contents|table of contents)'; then
		warn "$rel is $lines lines with no Contents section in its first 40 lines"
	fi
done

# Doc-rot phrasing, two classes. This check owns *phrasing*; whether a claim is
# still true is verified at revision time (see SKILL.md "Ship checklist"), not
# by grep — staleness is a fact about the world, not the text.
#
# Change-history prose narrates the past (history belongs in commit messages),
# and "at the time of writing" is a snapshot with its date deleted — both warn
# unconditionally. A *dated* as-of caveat is sanctioned standing prose (the
# "honest as-of caveat" in SKILL.md's timeless-present rule), so verification
# banners warn only when the line carries no anchor at all: a date, a version
# ("as of UTM 4.7.x"), or a live-source pointer ("verified against `--help`").
# Inline-code spans and fenced code blocks are stripped first (blanked, so
# line numbers stay stable) so teaching examples that quote the very phrasing
# they warn against (`recent changes`, a grep for the markers) don't self-trip.
# Bare "previously", "no longer" and "used to" are absent: they are mostly
# present tense ("commands that previously failed", "paths that no longer
# exist", "can be used to"), so only "used to" plus a state verb counts.
history_re='\b(used to (be|work|have|require|need)|recent changes|renamed[^.]*recently|recently (added|changed|moved)|at the time of writing)\b'
# Bare 'checked' is deliberately absent: it swallows instructive prose
# ("spot-checked against", "checked out locally"), which is a rule, not a claim.
banner_re='\b(current as of|as of|last verified|verified against)\b'
year_re='(19|20)[0-9]{2}'
version_re='(as of|verified against)[^;]{0,40}[0-9]+\.[0-9]+(\.[0-9x]+)?'
pointer_re='verified against[[:space:]]*`'
# The sed strips inline-code spans; its single-quoted backticks are literal.
# shellcheck disable=SC2016
for rel in ${files[@]+"${files[@]}"}; do
	[[ $rel == *.md ]] || continue
	fenced=$(awk 'BEGIN { fence = 0 }
		/^[ \t]*```/ { fence = !fence; print ""; next }
		fence { print ""; next }
		{ print }' "$dir/$rel")
	stripped=$(sed -E 's/`[^`]*`//g' <<<"$fenced")
	while IFS= read -r hit; do
		warn "possible doc-rot phrasing: $rel:$hit"
	done < <(grep -nEi "$history_re" <<<"$stripped" || true)
	# The anchor test runs on content only (never grep -n's line-number prefix,
	# which could itself look like a year), on the unstripped line so a code
	# span can serve as the pointer, and includes the following line, since an
	# honest caveat often wraps: "(as of\nmid-2026, v0.93)".
	while IFS= read -r hit; do
		lineno=${hit%%:*}
		window="$(sed -n "${lineno}p;$((lineno + 1))p" <<<"$fenced" | tr '\n' ' ')"
		shopt -s nocasematch
		anchored=0
		[[ $window =~ $year_re || $window =~ $version_re || $window =~ $pointer_re ]] && anchored=1
		shopt -u nocasematch
		((anchored)) && continue
		warn "undated verification banner (date it or point at a live source): $rel:$hit"
	done < <(grep -nEi "$banner_re" <<<"$stripped" || true)
done

# --- Authoritative validator, when available ---------------------------------
if command -v skills-ref >/dev/null 2>&1; then
	skills-ref validate "$dir" || err "skills-ref validate failed (see output above)"
else
	echo "note: skills-ref not installed; skipped the reference validator"
fi

echo "$errors error(s), $warnings warning(s)"
((errors == 0)) || exit 1
