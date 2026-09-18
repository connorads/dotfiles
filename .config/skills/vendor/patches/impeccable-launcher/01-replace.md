set -e
set -u

# LOCAL PATCH: catalogue maintenance owns installation and updates.
export IMPECCABLE_NO_UPDATE_CHECK=1 IMPECCABLE_NO_TELEMETRY=1
case "${1:-}" in
  install|link|update)
    echo "impeccable: use the reviewed catalogue maintenance workflow for installation and updates" >&2
    exit 2 ;;
esac
