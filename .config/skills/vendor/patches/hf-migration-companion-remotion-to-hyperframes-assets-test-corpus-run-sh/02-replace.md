
set -euo pipefail
export HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_NO_TELEMETRY=1

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$THIS_DIR/../.." && pwd)"

LINT="$SKILL_DIR/scripts/lint_source.py"
REPORT="$THIS_DIR/run-report.json"
