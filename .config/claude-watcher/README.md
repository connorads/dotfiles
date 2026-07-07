# claude-watch — per-pane auto-continue for Claude Code

When Claude Code hits its 5-hour rolling usage limit it **blocks input** (it
doesn't exit) and prints:

> `Claude usage limit reached. Your limit will reset at 3pm (America/Santiago).`

A long or overnight task then just sits there until you manually resume.
`claude-watch` watches one pane, detects that banner, waits until the **real**
reset time, types a continue message, verifies it landed, and keeps watching
for the next window — until you disarm it or the pane dies.

It is **per-pane and opt-in**: nothing runs until you arm a specific pane.
There is no package, no `claude` wrapper, no shell-rc hook, and no Claude
internals are touched — the watcher is a `tmux run-shell -b` background job keyed
to `#{pane_id}`, plus a stdlib-only Python date parser.

## Quick start

- **Arm / disarm:** `prefix + T` → `Claude: auto-continue watcher` in the
  target pane, right-click the pane and choose `Arm/disarm claude-watch`, or run
  `claude-watch` from a shell in that pane. The pane border shows **` ARMED`**
  (green) while active.
- **Status / explicit control:** `claude-watch [status|on|off|toggle] [pane_id]`.
- **Watch what it's doing:** `tail -f ~/.local/state/claude-watcher/<pane>.log`
  (e.g. pane `%5` → `…/claude-watcher/5.log`).

## How it works

1. **Detect** — every `POLL`s, `capture-pane` the last ~20 lines, strip ANSI,
   and look for a *limit* line and a *reset* line within 6 lines of each other
   (Claude wraps the banner across several TUI box lines).
2. **Wait** — parse the reset time (`reset-time.py`) and sleep until then
   `+ margin`. The 5-hour window is *rolling*, so a fixed sleep would waste time
   — we wait for the actual printed reset. If parsing fails, a fixed fallback
   (~5h10m) is used.
3. **Re-scrape** — when the wait elapses, scrape again; if the banner is gone
   (you already continued), reset and keep monitoring without sending.
4. **Gate** — only type if the pane still exists and Claude is the foreground
   process (`pane_current_command` allow-list, refined by a `+` foreground row
   on the pane tty). Otherwise skip and re-check shortly — never type into vim
   or a shell.
5. **Send** — `send-keys -l <message>`, ~400ms pause, then a separate `C-m`
   (dodges the bracketed-paste / Enter-swallow race). Verify by re-scraping;
   retry up to 3×.
6. **Re-arm** — go back to monitoring for the next window.

### Caps & ceiling

- **Wait ceiling** (`CEILING`, default 6h): if the computed wait exceeds it —
  e.g. the **weekly/Opus** limit (`Opus weekly limit reached ∙ resets Oct 6,
  1pm`), which is days away — the watcher logs, **notifies (backed-off)**, and
  disarms rather than sleeping for days.
- **Rapid cap** (`RAPID_CAP`, default 10): consecutive resumes; the counter
  resets after a quiet gap (`RAPID_GAP`, default 30min).
- **Lifetime cap** (`LIFETIME_CAP`, default 50): backstop over the watcher's
  whole life.
- Hitting either cap → log, **notify (gave-up)**, disarm.

Only **backed-off** and **gave-up** notify; the happy path is log-only.

## Configuration (env vars, all optional)

| Var | Default | Meaning |
|---|---|---|
| `CLAUDE_WATCH_POLL` | `30` | Poll interval (seconds). |
| `CLAUDE_WATCH_MARGIN` | `60` | Seconds added after the parsed reset. |
| `CLAUDE_WATCH_CEILING` | `21600` | Max wait (6h); above this → back off + disarm. |
| `CLAUDE_WATCH_FALLBACK` | `18600` | Fixed wait (~5h10m) when the reset is unparseable. |
| `CLAUDE_WATCH_MSG` | `Continue where you left off.` | Resume message typed into the pane. |
| `CLAUDE_WATCH_RAPID_CAP` | `10` | Consecutive-resume cap. |
| `CLAUDE_WATCH_RAPID_GAP` | `1800` | Quiet gap (s) that resets the rapid counter. |
| `CLAUDE_WATCH_LIFETIME_CAP` | `50` | Lifetime resume backstop. |
| `CLAUDE_WATCH_NOTIFY_CMD` | *(unset)* | Custom notify command; receives `event` (`$1`) and `message` (`$2`). |
| `CLAUDE_WATCH_PY` | *(unset)* | Python interpreter override (else `python3` from PATH). |
| `CLAUDE_WATCH_TMUX` | *(unset)* | tmux binary override (else `tmux` from PATH). |

`CLAUDE_WATCH_PY` / `CLAUDE_WATCH_TMUX` are defensive overrides only — the
`claude-watch` toggle resolves both from your interactive PATH and forwards them
(and any tuning vars above) into the `run-shell` server environment, so you
rarely need to set them by hand.

### Notify examples

```sh
# ntfy.sh push to your phone
export CLAUDE_WATCH_NOTIFY_CMD='sh -c "curl -s -d \"claude-watch [$1]: $2\" ntfy.sh/your-topic"'

# Telegram bot
export CLAUDE_WATCH_NOTIFY_CMD='sh -c "curl -s \"https://api.telegram.org/bot$TG_TOKEN/sendMessage\" -d chat_id=$TG_CHAT -d text=\"claude-watch [$1]: $2\""'
```

### Test hooks

| Var | Effect |
|---|---|
| `CLAUDE_WATCH_FAKE_BANNER` | Treat the pane as showing this banner (skip capture). |
| `CLAUDE_WATCH_FAKE_RESET` | Bypass parsing: absolute epoch (large) or seconds-away (small). |
| `CLAUDE_WATCH_DRY_RUN=1` | Log "would send …" instead of typing. |

## Troubleshooting

- **Nothing happens** → `tail ~/.local/state/claude-watcher/<pane>.log`. Common
  lines: `foreground is not Claude — skipping` (the gate fired — Claude wasn't
  at the prompt), `computed wait … exceeds ceiling` (weekly/Opus → disarmed).
- **It typed but Claude didn't submit** → the bracketed-paste race; the split
  `-l` / pause / `C-m` send plus 3× verify is the mitigation. Increase the pause
  by editing `cw_send` if your latency is high.
- **Fixed fallback instead of a parsed wait** → the banner's timezone wasn't
  resolvable (no `tzdata`?) or the format changed. Check the log; the wait will
  still happen, just less precisely.
- **Disarm didn't stop it** → `claude-watch status <pane>`; the watcher runs in
  its own process group and is killed by group, so a stale PID file alone won't
  keep it alive.

## Tests

`tests/run.sh` runs both suites with no tmux required:

- `tests/test-reset-time.py` — pure parser, deterministic via `--now` (exact
  epochs, DST boundary, relative, calendar, garbage → fallback).
- `tests/test-detect.sh` — detection + classification over real ANSI
  `fixtures/` (5-hour, weekly/Opus over-ceiling, wrapped banner, negatives).

## Known limitations (by design)

- A tmux server restart / `tmux-resurrect` restore kills watchers — re-arm
  manually (`@claude_armed` does not auto-restore).
- Detection reads the visible pane; if you're scrolled up in copy-mode at poll
  time it may read stale text (mitigated by the re-check at send time).
- On headless boxes the default notify only lands on reattach unless you wire
  `CLAUDE_WATCH_NOTIFY_CMD` to a phone push.
- Hosts without `tzdata` fall back to the fixed wait (less precise, still works).

## Design rationale / decisions

- **Polling, not the hook.** Claude Code fires a `StopFailure` hook with
  `error == "rate_limit"`, but it's **global** `settings.json` config (fights
  per-pane opt-in) and **carries no reset time** (you'd still scrape the banner).
  Polling `capture-pane` fits this design better. Upstream FR for a reset-time
  hook: [anthropics/claude-code#55945](https://github.com/anthropics/claude-code/issues/55945).
- **Parse the reset time, don't fixed-sleep.** The window is rolling; hitting
  the limit late means it can reset in well under an hour — a fixed 5h sleep
  wastes that.
- **Date maths in Python (stdlib `zoneinfo`/`datetime`).** BSD `date` lacks
  `-d`, so pure-shell isn't portable; no pip/`tzdata` needed on hosts with
  system zoneinfo.
- **Foreground gate adapted, not copied.** The reference is handed Claude's real
  PID; we only have `#{pane_id}`, so we gate on `pane_current_command` +
  a `+` foreground row on the pane tty.
- **tmux-native lifecycle.** `run-shell -b` job, `setsid` into its own process
  group (so disarm kills the whole tree), self-written PID file (the `-b` child
  PID is hidden from the launcher), `@claude_armed` pane option for the border
  marker. *Escape hatch:* if a long-lived `run-shell -b` ever proves flaky, the
  watcher already `setsid`s, so the toggle could switch to a plain
  `setsid watcher.sh &` detach with no other changes.

Reference tool this mirrors:
[cheapestinference/claude-auto-retry](https://github.com/cheapestinference/claude-auto-retry)
(an npm package that wraps the `claude` binary) — the algorithms (`stripAnsi`,
detection windows, reset-time parsing, foreground gate, post-wait re-scrape) are
ported from its `src/`.
