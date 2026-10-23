# `./run.sh tier-4-escape-hatch` works on a clean checkout.
require_render_tier_tools() {
  if [[ ! -f "$HF_CLI" ]]; then
    echo "error: HF CLI not built at $HF_CLI" >&2
    echo "       Run 'bun run --filter @hyperframes/cli build' in $REPO_ROOT" >&2
    return 2
  fi
