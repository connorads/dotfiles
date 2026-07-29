#!/usr/bin/env bash
# caffeine-reconcile.sh: the backstop half of lid mode's two-layer safety model.
#
# A lid session raises the SleepDisabled kernel flag, which has no process to
# hang its lifetime on. Layer 1 is the supervisor in caffeine-lib.sh, whose trap
# clears the flag on every *ordinary* exit — manual stop, deadline expiry,
# SIGTERM. That covers everything except the cases where no trap can run:
# SIGKILL, a crash, a kernel panic (this machine has had one — it is what exposed
# the resurrect staleness bug) and a reboot. This is layer 2 for exactly those.
#
# A launchd agent (dev.connorads.tmux-caffeine-reconcile) runs it every 5 min
# AND at load. RunAtLoad is what covers the panic and reboot cases: the flag
# survives a reboot, so without it a panicked Mac would come back up unable to
# sleep, with nothing on screen saying why.
#
# Neither layer alone is sufficient. The supervisor misses the panic; this alone
# would leave up to 5 minutes of wrong state on every normal stop, and would give
# the status pill nothing to report in the meantime.
#
# Same never-swallow-errors logging posture as resurrect-keepalive.sh: capture
# the exit code and stderr rather than >/dev/null, and nag each attached client
# by name (from launchd there is no "current client", so an untargeted
# display-message would no-op).
# --- bash5 re-exec preamble: keep 3.2-parseable, keep above `set -u` ---
# macOS ships bash 3.2 at /bin/bash and tmux hands it to run-shell. Re-exec under
# the nix bash 5 that is already installed but ordered behind /bin in PATH.
if [ "${BASH_VERSINFO[0]:-0}" -lt 5 ]; then
	if [ -n "${TMUX_BASH5_REEXEC:-}" ]; then
		printf '%s: re-exec did not yield bash >= 5 (got %s)\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
		exit 127
	fi
	for _b5 in "/etc/profiles/per-user/${USER:-$LOGNAME}/bin/bash" \
		/run/current-system/sw/bin/bash "$HOME/.nix-profile/bin/bash" \
		/nix/var/nix/profiles/default/bin/bash /opt/homebrew/bin/bash; do
		if [ -x "$_b5" ]; then
			TMUX_BASH5_REEXEC=1
			export TMUX_BASH5_REEXEC
			exec "$_b5" "$0" ${1+"$@"}
		fi
	done
	printf '%s: requires bash >= 5, found %s\n' "${0##*/}" "${BASH_VERSION:-?}" >&2
	exit 127
fi
# Never inherited: each script guards itself, so a bash-5 parent must not
# suppress a 3.2 child's own re-exec.
unset TMUX_BASH5_REEXEC _b5
# --- end bash5 preamble ---

set -euo pipefail

# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Shared keep-awake vocabulary (caffeine_state / caffeine_sleep_disabled /
# caffeine_clear_sleep_disabled / CAFFEINE_PIDFILE).
# shellcheck source=/dev/null
. "$SELF_DIR/caffeine-lib.sh"

LOG="${CAFFEINE_RECONCILE_LOG:-$HOME/.cache/tmux-caffeine-reconcile.log}"

mkdir -p "$(dirname "$LOG")"

log() {
	printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >>"$LOG"
}

# tmux on the default socket, never a nested one: from launchd there is no TMUX;
# run by hand from inside tmux, `-u TMUX` still forces the user's real server
# rather than whatever nested/throwaway context invoked it.
tmux_default() { env -u TMUX tmux "$@"; }

# 1. Flag clear ⇒ nothing to reconcile. The overwhelmingly common case, and the
#    only one that must stay cheap: this runs every 5 minutes forever.
if ! caffeine_sleep_disabled; then
	exit 0
fi

# 2. Flag set with a live lid session behind it ⇒ this is the normal case, and
#    the session owns the flag until its own deadline. Leave it alone.
state="$(caffeine_state)"
if [ "$state" = "ON-LID" ]; then
	exit 0
fi

# 3. Flag set with nothing holding it: the supervisor was SIGKILLed, crashed,
#    panicked, or the Mac rebooted with the flag persisted. Clear it — a Mac
#    that cannot sleep, with nothing on screen saying so, is precisely the
#    failure lid mode was built to avoid creating.
set +e
clear_err=$(caffeine_clear_sleep_disabled 2>&1 >/dev/null)
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
	log "CLEAR FAILED rc=$rc state=$state${clear_err:+ err=${clear_err//$'\n'/ }}"
	msg="⚠ caffeine: Mac cannot sleep, and clearing the flag failed"
elif caffeine_sleep_disabled; then
	# pmset returned 0 but the flag is still up — the same does-not-stick failure
	# caffeine_start_lid reads back against, seen from the other end.
	log "CLEAR INEFFECTIVE state=$state (pmset rc=0, SleepDisabled still set)"
	msg="⚠ caffeine: Mac cannot sleep, and the flag will not clear"
else
	log "cleared stray SleepDisabled state=$state"
	msg="caffeine: cleared a stray keep-awake — the Mac can sleep again"
fi

# 4. Tell whoever is attached. The pill already went OFF when the supervisor
#    died, so this is the only surface that reports the flag outliving it.
while IFS= read -r client; do
	[ -n "$client" ] || continue
	tmux_default display-message -c "$client" "$msg" 2>/dev/null || true
done < <(tmux_default list-clients -F '#{client_name}' 2>/dev/null || true)
