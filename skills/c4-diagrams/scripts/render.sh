#!/usr/bin/env bash
# render.sh: render a C4 diagram source to an image, picking the tool by file type.
# Supports Mermaid (.mmd/.mermaid), Structurizr DSL (.dsl), PlantUML
# (.puml/.plantuml/.pu), and D2 (.d2). Prefers a locally-installed renderer and
# falls back to `pnpm dlx` / Docker, printing a clear hint when nothing is found.
#
# Usage:
#   render.sh [--dry-run] [--format FMT] <source> [output]
#   render.sh --help
#
# --dry-run   Print the command that would run, don't execute (offline-safe).
# --format    Override detection: mermaid | structurizr | plantuml | d2.
# output      Output path (default: <source-basename>.svg). Ignored for .dsl,
#             which exports one Mermaid file per view next to the source.
#
# Exit codes: 0 ok · 2 usage error · 3 no renderer available · non-zero = render failed.
set -euo pipefail

die() {
	printf 'render.sh: %s\n' "$1" >&2
	exit "${2:-2}"
}
have() { command -v "$1" >/dev/null 2>&1; }

DRY=0
FORMAT=""
SRC=""
OUT=""

while [ $# -gt 0 ]; do
	case "$1" in
	--help | -h)
		awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
		exit 0
		;;
	--dry-run | -n)
		DRY=1
		shift
		;;
	--format)
		FORMAT="${2:-}"
		shift 2
		;;
	-*) die "unknown option: $1" ;;
	*)
		if [ -z "$SRC" ]; then SRC="$1"; elif [ -z "$OUT" ]; then OUT="$1"; else die "too many args"; fi
		shift
		;;
	esac
done

[ -n "$SRC" ] || die "no source file given (see --help)"
[ -f "$SRC" ] || [ "$DRY" -eq 1 ] || die "source not found: $SRC"

# Detect format from extension unless overridden.
if [ -z "$FORMAT" ]; then
	case "$SRC" in
	*.mmd | *.mermaid) FORMAT=mermaid ;;
	*.dsl) FORMAT=structurizr ;;
	*.puml | *.plantuml | *.pu) FORMAT=plantuml ;;
	*.d2) FORMAT=d2 ;;
	*) die "cannot detect format from '$SRC'; pass --format" ;;
	esac
fi

base="${SRC##*/}"
base="${base%.*}"
dir="$(cd "$(dirname "$SRC")" 2>/dev/null && pwd || echo .)"
[ -n "$OUT" ] || OUT="${dir}/${base}.svg"

run() {
	printf '+ %s\n' "$*" >&2
	if [ "$DRY" -eq 1 ]; then return 0; fi
	"$@"
}

case "$FORMAT" in
mermaid)
	if have mmdc; then
		run mmdc -i "$SRC" -o "$OUT"
	elif have pnpm; then
		# pnpm dlx pulls @mermaid-js/mermaid-cli (and headless Chromium) on first run.
		run pnpm dlx @mermaid-js/mermaid-cli -i "$SRC" -o "$OUT"
	else
		die "no Mermaid renderer. Install: 'mise use -g npm:@mermaid-js/mermaid-cli' or use pnpm. (Mermaid also renders natively on GitHub - just paste the fenced block.)" 3
	fi
	;;

d2)
	if have d2; then
		run d2 "$SRC" "$OUT"
	else
		die "no d2. Install: 'mise use -g aqua:terrastruct/d2' or 'brew install d2'." 3
	fi
	;;

plantuml)
	if have plantuml; then
		run plantuml -tsvg "$SRC"
	elif have docker; then
		run docker run --rm -v "$dir:/work" -w /work plantuml/plantuml -tsvg "$base.puml"
	else
		die "no PlantUML. Install 'plantuml' + 'graphviz', or run via Docker, or use a PlantUML server URL." 3
	fi
	;;

structurizr)
	# DSL renders nowhere natively: export to Mermaid (one .mmd per view), which
	# also validates the model. Then render each with the mermaid path if possible.
	if have structurizr; then
		run structurizr export -workspace "$SRC" -format mermaid
	elif have docker; then
		run docker run --rm -v "$dir:/work" -w /work structurizr/cli \
			export -workspace "$base.dsl" -format mermaid
	else
		die "no Structurizr tool. Run via Docker (structurizr/cli) or install the 'structurizr' CLI. See references/structurizr-dsl.md." 3
	fi
	if [ "$DRY" -eq 0 ]; then
		printf 'render.sh: exported Mermaid views to %s/*.mmd (validated). Render each with: render.sh <view>.mmd\n' "$dir" >&2
	fi
	;;

*) die "unsupported format: $FORMAT" ;;
esac

if [ "$DRY" -eq 0 ] && [ "$FORMAT" != structurizr ]; then
	printf 'render.sh: wrote %s\n' "$OUT" >&2
fi
