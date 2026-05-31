#!/usr/bin/env sh
# watcher.sh: per-pane Claude Code rate-limit auto-continue poll loop.
#
# Launched by `claude-watch` via `tmux run-shell -b '… watcher.sh #{pane_id}'`.
# NOT dual-mode (no zsh shebang) -> zfn-link does not symlink it onto PATH; it's
# always invoked by full path. Poll-based by design (Claude's StopFailure hook
# is global + carries no reset time). See ./README.md for the full rationale.
#
# Test entrypoints (no tmux needed): `watcher.sh __detect`  (stdin -> exit 0/1),
# `watcher.sh __classify [--now EPOCH]` (stdin -> none|five-hour|over-ceiling).
set -u

# ---- configuration (all overridable via env; see README) ----
POLL="${CLAUDE_WATCH_POLL:-30}"
MARGIN="${CLAUDE_WATCH_MARGIN:-60}"
CEILING="${CLAUDE_WATCH_CEILING:-21600}"          # 6h: above this -> back off
FALLBACK="${CLAUDE_WATCH_FALLBACK:-18600}"        # ~5h10m if reset unparseable
MSG="${CLAUDE_WATCH_MSG:-Continue where you left off.}"
RAPID_CAP="${CLAUDE_WATCH_RAPID_CAP:-10}"
RAPID_GAP="${CLAUDE_WATCH_RAPID_GAP:-1800}"       # >30min gap resets rapid count
LIFETIME_CAP="${CLAUDE_WATCH_LIFETIME_CAP:-50}"
TMUX_BIN="${CLAUDE_WATCH_TMUX:-tmux}"             # optional override; PATH tmux otherwise
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/claude-watcher"
# shellcheck disable=SC1007  # `CDPATH= cd` is the env-prefix idiom, not a bad assign
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FG_ALLOW="node claude npx tsx bun deno"

resolve_py() {
  if [ -n "${CLAUDE_WATCH_PY:-}" ]; then printf '%s\n' "$CLAUDE_WATCH_PY"; return 0; fi
  command -v python3 2>/dev/null
}

# ---- detection (mirrors claude-auto-retry patterns.js) ----

# Strip CSI colour/cursor + OSC sequences. esc/bel built at runtime so the
# script stays plain ASCII. Defensive double-strip also lives in reset-time.py.
cw_strip_ansi() {
  _esc=$(printf '\033'); _bel=$(printf '\007')
  sed -e "s/${_esc}\[[0-9;?]*[A-Za-z]//g" -e "s/${_esc}\][^${_bel}]*${_bel}//g"
}

# Window match: a "limit" line and a "reset" line within 6 lines of each other
# (Claude wraps the banner across several TUI box lines). Input must be
# lowercased first (POSIX awk has no IGNORECASE); intervals avoided for old awks.
cw_awk_detect() {
  awk '
    function is_limit(s){
      return (s ~ /[0-9]+-hour limit/ || s ~ /limit reached/ || s ~ /usage limit/ \
        || s ~ /out of.*usage/ || s ~ /rate limit/ || s ~ /weekly limit/ \
        || s ~ /(hit|exceeded|reached).*(your|the).*limit/ || s ~ /try again in/)
    }
    function is_reset(s){
      return (s ~ /resets?[ ]+(at[ ]+)?[0-9]/ \
        || s ~ /resets?[ ]+(on[ ]+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/ \
        || s ~ /resets?[ ]+in[: ]/ || s ~ /try again in[ ]+[0-9]/)
    }
    { L[NR]=$0 }
    END{
      for(i=1;i<=NR;i++) if(is_limit(L[i])){
        lo=i-6; if(lo<1)lo=1; hi=i+6; if(hi>NR)hi=NR
        for(j=lo;j<=hi;j++) if(is_reset(L[j])) exit 0
      }
      exit 1
    }'
}

# stdin: raw capture -> exit 0 if rate-limited.
cw_detect() { cw_strip_ansi | tr '[:upper:]' '[:lower:]' | cw_awk_detect; }

# stdin: stripped banner (original case, for ZoneInfo) -> echoes reset epoch.
cw_reset_epoch() {  # $1 = now epoch
  _py=$(resolve_py) || return 1
  [ -n "$_py" ] || return 1
  "$_py" "$SELF_DIR/reset-time.py" --now "$1" --margin "$MARGIN"
}

# ---- test entrypoints (dispatched before any tmux/setsid work) ----
case "${1:-}" in
  __detect)
    if cat | cw_detect; then echo detected; exit 0; else echo none; exit 1; fi
    ;;
  __classify)
    shift
    cls_now=$(date +%s)
    while [ $# -gt 0 ]; do
      case "$1" in
        --now) cls_now=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    raw=$(cat)
    stripped=$(printf '%s' "$raw" | cw_strip_ansi)
    if ! printf '%s' "$stripped" | tr '[:upper:]' '[:lower:]' | cw_awk_detect; then
      echo none; exit 1
    fi
    epoch=$(printf '%s' "$stripped" | cw_reset_epoch "$cls_now" 2>/dev/null || true)
    if [ -n "$epoch" ]; then delay=$((epoch - cls_now)); else delay=$FALLBACK; fi
    [ "$delay" -lt 0 ] && delay=0
    if [ "$delay" -gt "$CEILING" ]; then echo over-ceiling; else echo five-hour; fi
    exit 0
    ;;
esac

# ===================== main watcher =====================
pane="${1:-${TMUX_PANE:-}}"
[ -n "$pane" ] || { echo "usage: watcher.sh <pane_id>" >&2; exit 2; }
pane_safe="${pane#%}"
PIDFILE="$STATE_DIR/${pane_safe}.pid"
LOG="$STATE_DIR/${pane_safe}.log"

# Own a fresh process group so the toggle can kill the whole tree via
# `kill -- -<PGID>`. run-shell -b hides the child PID, so we self-detach and
# write our own PID below (the toggle never writes it).
if [ -z "${CLAUDE_WATCH_SETSID:-}" ] && command -v setsid >/dev/null 2>&1; then
  # Resolve to an absolute path: setsid execvp's its argument, so a bare
  # relative "$0" (e.g. `sh watcher.sh`) would fail to be found.
  CLAUDE_WATCH_SETSID=1 exec setsid "$SELF_DIR/$(basename -- "$0")" "$@"
fi

mkdir -p "$STATE_DIR"
printf '%s\n' "$$" > "$PIDFILE"

cw_log() {
  _ts=$(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || date 2>/dev/null || echo '?')
  printf '%s %s\n' "$_ts" "$*" >> "$LOG"
}

# Notify on backed-off / gave-up only (the happy path is log-only).
#   1. CLAUDE_WATCH_NOTIFY_CMD if set — receives event ($1) + message ($2), so
#      ntfy/Telegram bridges work on headless boxes.
#   2. else desktop popup if a session is present (osascript / notify-send).
#   3. always: tmux message + a bell on the pane tty (lands on reattach).
cw_notify() {  # $1 = event, $2 = message
  _ev="$1"; _msg="$2"
  cw_log "NOTIFY [$_ev] $_msg"

  if [ -n "${CLAUDE_WATCH_NOTIFY_CMD:-}" ]; then
    sh -c "$CLAUDE_WATCH_NOTIFY_CMD" _ "$_ev" "$_msg" 2>/dev/null
    return
  fi

  $TMUX_BIN display-message -t "$pane" "claude-watch [$_ev]: $_msg" 2>/dev/null
  _tty=$($TMUX_BIN display -p -t "$pane" '#{pane_tty}' 2>/dev/null)
  [ -n "$_tty" ] && printf '\a' > "$_tty" 2>/dev/null

  if [ "$(uname 2>/dev/null)" = Darwin ] && command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$_msg\" with title \"claude-watch: $_ev\"" 2>/dev/null
  elif { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; } && command -v notify-send >/dev/null 2>&1; then
    notify-send "claude-watch: $_ev" "$_msg" 2>/dev/null
  fi
}

cw_cleanup() {
  $TMUX_BIN set -p -u -t "$pane" @claude_armed 2>/dev/null
  rm -f "$PIDFILE" 2>/dev/null
}
# EXIT does the cleanup; INT/TERM must *exit* (a bare signal trap would run the
# handler then resume the poll loop, surviving disarm) — exit fires EXIT.
trap 'cw_cleanup' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

cw_pane_alive() {
  _id=$($TMUX_BIN display -p -t "$pane" '#{pane_id}' 2>/dev/null) || return 1
  [ -n "$_id" ]
}

cw_capture() {
  if [ -n "${CLAUDE_WATCH_FAKE_BANNER:-}" ]; then
    printf '%s\n' "$CLAUDE_WATCH_FAKE_BANNER"; return 0
  fi
  $TMUX_BIN capture-pane -t "$pane" -p -S -20 2>/dev/null
}

# Primary: pane_current_command in the allow-list. Refinement: a foreground ('+')
# row on the pane's tty whose comm is allow-listed. Either -> Claude is at the
# prompt; neither -> skip (don't type into vim/shell).
cw_is_claude_fg() {
  _cmd=$($TMUX_BIN display -p -t "$pane" '#{pane_current_command}' 2>/dev/null)
  case " $FG_ALLOW " in *" $_cmd "*) return 0 ;; esac
  _tty=$($TMUX_BIN display -p -t "$pane" '#{pane_tty}' 2>/dev/null)
  [ -n "$_tty" ] || return 1
  ps -t "${_tty#/dev/}" -o stat=,comm= 2>/dev/null | awk -v allow=" $FG_ALLOW " '
    $1 ~ /\+/ { c=$2; sub(/.*\//,"",c); if (index(allow, " " c " ")) found=1 }
    END { exit found?0:1 }'
}

# Split send (-l literal text, pause, separate C-m) dodges the bracketed-paste /
# Enter-swallow race. Verify by re-scraping: banner gone == landed. 3 tries.
cw_send() {
  if [ "${CLAUDE_WATCH_DRY_RUN:-}" = "1" ]; then
    cw_log "DRY_RUN: would send \"$MSG\""
    return 0
  fi
  _n=0
  while [ "$_n" -lt 3 ]; do
    _n=$((_n + 1))
    $TMUX_BIN send-keys -t "$pane" -l "$MSG" 2>/dev/null
    sleep 0.4
    $TMUX_BIN send-keys -t "$pane" C-m 2>/dev/null
    sleep 1
    if ! cw_capture | cw_detect; then
      cw_log "sent (attempt $_n), banner cleared"
      return 0
    fi
    cw_log "send attempt $_n: banner still present, retrying"
    sleep $((_n * 2))
  done
  return 1
}

cw_log "watcher started for pane $pane (pid $$, poll ${POLL}s)"

state=monitoring
attempts=0          # rapid-consecutive sends
lifetime=0          # lifetime backstop
last_send=0
wake=0              # epoch to stop waiting

while :; do
  sleep "$POLL"

  if ! cw_pane_alive; then
    cw_log "pane $pane gone — exiting"
    exit 0
  fi

  now=$(date +%s)
  raw=$(cw_capture)

  if [ "$state" = waiting ]; then
    [ "$now" -lt "$wake" ] && continue

    # Re-scrape first: if the banner cleared (user continued, or time passed),
    # resume monitoring without sending.
    if ! printf '%s' "$raw" | cw_detect; then
      cw_log "banner cleared during wait — resuming monitoring"
      state=monitoring; attempts=0
      continue
    fi

    # Foreground gate — skip + recheck soon if Claude isn't at the prompt.
    if ! cw_is_claude_fg; then
      cw_log "foreground is not Claude — skipping send this tick"
      wake=$((now + POLL * 6))
      continue
    fi

    # Caps (checked at send time). Rapid count resets after a long quiet gap.
    [ $((now - last_send)) -gt "$RAPID_GAP" ] && attempts=0
    if [ "$lifetime" -ge "$LIFETIME_CAP" ]; then
      cw_log "lifetime cap ($LIFETIME_CAP) reached — giving up, disarming"
      cw_notify gave-up "lifetime send cap reached on pane $pane"
      exit 0
    fi
    if [ "$attempts" -ge "$RAPID_CAP" ]; then
      cw_log "rapid cap ($RAPID_CAP) reached — giving up, disarming"
      cw_notify gave-up "rapid send cap reached on pane $pane"
      exit 0
    fi

    attempts=$((attempts + 1))
    lifetime=$((lifetime + 1))
    last_send=$now
    if cw_send; then
      cw_log "resume sent (rapid $attempts, lifetime $lifetime) — re-arming"
      state=monitoring
    else
      cw_log "send failed after retries — will retry next window"
      wake=$((now + POLL * 2))
    fi
    continue
  fi

  # state = monitoring
  printf '%s' "$raw" | cw_detect || continue

  if [ -n "${CLAUDE_WATCH_FAKE_RESET:-}" ]; then
    fr=$CLAUDE_WATCH_FAKE_RESET
    if [ "$fr" -gt 10000000 ]; then delay=$((fr - now)); else delay=$fr; fi
  else
    stripped=$(printf '%s' "$raw" | cw_strip_ansi)
    epoch=$(printf '%s' "$stripped" | cw_reset_epoch "$now" 2>/dev/null || true)
    if [ -n "$epoch" ]; then delay=$((epoch - now)); else delay=$FALLBACK; fi
  fi
  [ "$delay" -lt 0 ] && delay=0

  if [ "$delay" -gt "$CEILING" ]; then
    cw_log "computed wait ${delay}s exceeds ceiling ${CEILING}s (weekly/Opus?) — backing off, disarming"
    cw_notify backed-off "reset is ${delay}s away (> ceiling) on pane $pane — disarmed"
    exit 0
  fi

  cw_log "rate limit detected — waiting ${delay}s"
  state=waiting
  wake=$((now + delay))
done
