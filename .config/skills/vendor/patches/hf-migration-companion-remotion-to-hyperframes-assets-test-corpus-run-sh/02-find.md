
set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$THIS_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"

LINT="$SKILL_DIR/scripts/lint_source.py"
DIFF="$SKILL_DIR/scripts/render_diff.sh"
STRIP="$SKILL_DIR/scripts/frame_strip.sh"
HF_CLI="$REPO_ROOT/packages/cli/dist/cli.js"
REPORT="$THIS_DIR/run-report.json"
