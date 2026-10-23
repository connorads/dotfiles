# `./run.sh tier-4-escape-hatch` works on a clean checkout.
require_render_tier_tools() {
  if ! command -v hyperframes >/dev/null 2>&1; then
    echo "error: managed hyperframes CLI not on PATH" >&2
    echo "       Provision it through the local tool workflow." >&2
    return 2
  fi
