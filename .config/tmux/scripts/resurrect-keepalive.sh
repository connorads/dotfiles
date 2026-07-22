#!/usr/bin/env bash
# resurrect-keepalive.sh: independent tmux-resurrect save driver + staleness
# alarm. A launchd agent (dev.connorads.tmux-resurrect-save) runs this every
# 5 min, so saving depends on launchd rather than tmux's status-bar refresh
# injecting continuum's autosave — the mechanism that silently stopped writing
# files for 3.5 weeks before a crash-reboot found no session to restore.
#
# Two fixes over continuum's fire-and-forget autosave (which runs
# `save.sh …>/dev/null 2>&1 &` then advances its timestamp unconditionally):
#   1. Capture save.sh's exit code + stderr to a log — stop swallowing errors.
#   2. Verify the newest save's freshness afterwards and raise a loud alarm
#      (@resurrect_stale option + a nag to each attached client) when saves have
#      gone stale, so failure surfaces within 15 min instead of invisibly.
# continuum stays enabled as cross-platform redundancy; the resulting minor
# double-save on macs is harmless (distinct timestamped files).
set -euo pipefail

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Shared freshness vocabulary (resurrect_dir / resurrect_newest_age_secs /
# resurrect_state / RESURRECT_*_SECS / resurrect_human_age).
# shellcheck source=/dev/null
. "$SELF_DIR/resurrect-lib.sh"

LOG="${RESURRECT_KEEPALIVE_LOG:-$HOME/.cache/tmux-resurrect-keepalive.log}"
# The plugin dir holding save.sh (overridable so the integration test can point
# at the real plugin from an isolated HOME).
RESURRECT_PLUGIN_DIR="${RESURRECT_PLUGIN_DIR:-$HOME/.config/tmux/plugins/tmux-resurrect}"
SAVE_SH="$RESURRECT_PLUGIN_DIR/scripts/save.sh"

mkdir -p "$(dirname "$LOG")"

log() {
	printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >>"$LOG"
}

# tmux on the default socket, never a nested one: from launchd there is no TMUX;
# run by hand from inside tmux, `-u TMUX` still forces the user's real server
# rather than whatever nested/throwaway context invoked it.
tmux_default() { env -u TMUX tmux "$@"; }

# 1. No server ⇒ nothing to save. Not an error — the box may simply have no tmux
#    up (e.g. right after boot, before the resurrect restore).
if ! tmux_default list-sessions >/dev/null 2>&1; then
	log "no server, skip"
	exit 0
fi

# 2. Save, capturing rc + stderr (the exact opposite of continuum's >/dev/null
#    2>&1). save.sh sources the same post-save hooks (strip-nix-paths,
#    session-ids) automatically.
set +e
save_err=$(env -u TMUX "$SAVE_SH" quiet 2>&1 >/dev/null)
rc=$?
set -e

# 3. Verify against the shared lib: age of the newest save + its state.
age=$(resurrect_newest_age_secs)
state=$(resurrect_state)
if [ "$rc" -ne 0 ]; then
	log "SAVE FAILED rc=$rc${save_err:+ err=${save_err//$'\n'/ }}"
else
	log "saved ok age=${age}s state=$state"
fi

# 4. Alarm on staleness (independent of this run's rc — a rc=0 save that still
#    leaves the newest file older than the stale line is the failure we care
#    about; NONE = no save file at all is worse). Set the @resurrect_stale
#    option for any consumer, and actively nag each attached client — from
#    launchd there is no "current client", so an untargeted display-message
#    would no-op; iterate the client list and target each by name. The pill
#    already reddens from mtime, so it is the primary surface; this is the poke.
if [ "$state" = "STALE" ] || [ "$state" = "NONE" ]; then
	tmux_default set -g @resurrect_stale 1
	if [ "$state" = "NONE" ]; then
		msg="⚠ resurrect: no save file"
	else
		msg="⚠ resurrect saves stale ($(resurrect_human_age "$age"))"
	fi
	while IFS= read -r client; do
		[ -n "$client" ] || continue
		tmux_default display-message -c "$client" "$msg" 2>/dev/null || true
	done < <(tmux_default list-clients -F '#{client_name}' 2>/dev/null || true)
	log "ALARM stale: set @resurrect_stale=1 ($msg)"
else
	tmux_default set -g @resurrect_stale 0
fi
