# AGENTS.md — tmux config

## When changing keybindings

**Update [`help.md`](./help.md) whenever you add, change, or remove a binding.**
It is the `prefix + ?` cheatsheet and the only human-facing list of binds; a
binding without its help row is invisible. [`tmux.conf`](./tmux.conf) carries a
top-of-file NOTE to the same effect. Treat the bind and its help row as one
coherent change and commit them together.

**Key conventions** (mirrored in the override/convention comment at the top of
the keybinds section in [`tmux.conf`](./tmux.conf)):

- A lowercase key's **Capital is its companion/sibling** - same identity, a
  variant or help view: `v`/`V` nvim + help, `f`/`F` fresh + help, `g`/`G`
  lazygit + lazygit-dotfiles. Follows Vim (`a`/`A`, `c`/`C`) and
  tmux-pain-control (`h`/`H`).
- **Alt is the standalone-tool pocket** - agent/session tools with no plain-key
  parent (`M-s` skl, `M-m` memory, `M-i` shotpath, `M-b` branch, `M-g` ghfzf,
  `M-j` jjui). Alt is *not* a "variant of the plain key" modifier: don't put a
  sibling on Alt, and new unrelated tools get a plain key, not Alt.
- Occasional utilities that each ran at ~0 tracked uses live in the `prefix + T`
  Tools launcher ([`tools.tsv`](./tools.tsv)), not a key each.

Verify a binding before committing: live-test on a throwaway server
(`tmux -L test new-session -d; tmux -L test source-file <(grep '^bind ...' tmux.conf); tmux -L test list-keys -T prefix | grep '<desc>'`),
or `tmux source-file ~/.config/tmux/tmux.conf` to reload the running server.

## Agent state dots (custom subsystem)

Window tabs show a per-window dot for the *worst* agent state across their panes.
The logic is spread across several files — change them as a set:

- [`scripts/agent-state.sh`](./scripts/agent-state.sh) — sets `@agent_state` per
  pane, rolls the worst up to `@win_agent_state`. Verbs:
  `working|blocked|done|unread|idle|seen|clear`. `unread` is the manual inverse
  of `seen` (force `done` even on the focused window — mark a read tab blue again).
  `done` is **seen-at-birth**: if you are already viewing the pane when it
  finishes (`is_viewing` — the sweep's gate: active pane / active window /
  attached session) it goes straight to idle; otherwise blue until you focus it.
- [`scripts/agent-journal.sh`](./scripts/agent-journal.sh) — sourced by
  `agent-state.sh` (phase 0): captures each hook's stdin payload and appends a
  **curated** JSONL event (ts/pane/window/state/kind + session_id, cwd,
  permission_mode, notification message, tool_name — plus `tool_input` for
  `ExitPlanMode` only, i.e. the plan text) to
  `~/.local/state/agent-journal/events-YYYY-MM.jsonl`. The dots show current
  state; the journal is the replayable history for audits and future cross-pane
  sequencing. Full tool inputs are deliberately not recorded (file contents /
  command lines can carry secrets). Fail-open, needs jq; disable with
  `AGENT_JOURNAL_DISABLE=1`, relocate with `AGENT_JOURNAL_DIR`. Monthly files:
  retention is deleting old months.
- [`scripts/agent-state-lib.sh`](./scripts/agent-state-lib.sh) — shared rank,
  rollup, bell, and `is_viewing` helpers (also used by `agent-sweep.sh`;
  `is_viewing` is the one definition of "you are looking at the pane", shared by
  the `done` branch and the sweep), **and the canonical
  state → glyph + colour mapping** (`agent_attrs`/`agent_hex`/`agent_char`/
  `agent_glyph`). **Shape** encodes state as well as colour so it reads on a
  colour clash and for colour-blind use; `working` is peach (not yellow) so it
  clears the same-yellow active-tab text. See [`help.md`](./help.md) for the
  legend.
- [`scripts/agent-stop.sh`](./scripts/agent-stop.sh) — Claude `Stop`/`StopFailure`
  hook adapter. Claude fires `Stop` at every clean turn-end, even while a
  background dynamic workflow / subagent is still draining; turns that end via
  API error fire `StopFailure` instead (`Stop` doesn't fire for those) and route
  through the same adapter. It jq-counts the in-flight
  *finite* work (`workflow|subagent|shell`) in the payload's `background_tasks`
  and forwards `working` while any remain, else `done` (degrades to `done` if jq
  is missing/the payload won't parse). Persistent watchers (`monitor`, `dream`)
  are excluded so they can't pin the dot at working forever.
- [`scripts/agent-sweep.sh`](./scripts/agent-sweep.sh) — phase-5 reconcile net (a
  one-shot on `client-attached` + a per-server daemon polling every `POLL`, 10s).
  Two jobs: (1) clear a stale dot whose agent died without a clean done/clear
  (shell foreground = agent gone); (2) age a `done` dot you are currently viewing
  (`is_viewing`: active pane, active window, `session_attached>0`) to idle — the
  deterministic backstop for the `done` branch's seen-at-birth and the focus
  hooks' `seen`, which they miss when the finish races your focus or you watch one
  agent while another finishes then return by switching windows (no fresh
  select-pane/window-changed). The attached-session gate keeps detached sessions
  unread (nobody looking).
- `@agent_dotfmt` (in [`tmux.conf`](./tmux.conf)) — renders the tab dot from the
  mapping. The popup reads the lib directly (`agent_glyph`); the tabs and the
  menu literals re-encode it and are guarded against drift by `agent-glyphs.bats`.
- Hooks: `~/.claude/settings.json` (and other agents' hooks) call
  `agent-state.sh` on lifecycle events; `Stop`/`StopFailure` route through
  `agent-stop.sh` (`working` while `background_tasks` holds finite in-flight
  work, `done` once drained). The `after-select-pane` / `session-window-changed` / `client-focus-in`
  hooks fire `seen` (focus = mark read), gated on `#{@agent_state}==done` so idle
  switches skip the fork and pay only `refresh-client -S`; `client-focus-in` (NOT
  `pane-focus-in`, which is inert as a global hook) catches regaining terminal
  focus without a navigation. `agent-sweep.sh` is the backstop when none of them fire.
- Menus: `prefix + Alt+.` and the right-click pane menu
  ([`scripts/context-menu.sh`](./scripts/context-menu.sh)) set a state by hand
  (literals must match the lib — see `agent-glyphs.bats`).

Tests (run `mise run zsh-tests`):

- [`../zsh/tests/agent-state.bats`](../zsh/tests/agent-state.bats) — verb behaviour + rollup.
- [`../zsh/tests/agent-journal.bats`](../zsh/tests/agent-journal.bats) — journal
  lines: curated fields, ExitPlanMode plan capture, no tool_input leak,
  disable/no-stdin/no-op-seen cases, Stop payload pass-through.
- [`../zsh/tests/tmux-agent-tabs.bats`](../zsh/tests/tmux-agent-tabs.bats) —
  asserts the **exact** `@agent_dotfmt` glyph/colour output against the real
  tmux.conf; update it when you change the state → glyph mapping.
- [`../zsh/tests/agent-glyphs.bats`](../zsh/tests/agent-glyphs.bats) — derives
  expectations from `agent-state-lib.sh` and asserts all four renderers (tabs,
  prefix+Alt+. menu, right-click pane menu, popup) match it; the drift guard
  for the mapping.
- [`../zsh/tests/agent-sweep.bats`](../zsh/tests/agent-sweep.bats) — stale-dot
  clearing + the viewed-`done` → idle reconcile (attached/inactive/detached gates).

Keep the dot legend in [`help.md`](./help.md) in sync with `@agent_dotfmt`.

## Resurrect agent-session restore (custom subsystem)

tmux-resurrect restores Claude/Codex/OpenCode panes via the custom strategies in
[`strategies/`](./strategies/) (synced into the plugin dir by a `run-shell cp`
in [`tmux.conf`](./tmux.conf)). **Fidelity rule**: a strategy rebuilds the
command from the *saved pane argv* (`$1`, from `ps -o args=`) rather than
emitting a bare `<agent> --resume <id>` - none of the three CLIs persist
permission mode / system-prompt append / model in the session, so dropping the
flags would restore a gated pane. The shared token filter lives in
[`scripts/lib/resurrect-argv.sh`](./scripts/lib/resurrect-argv.sh): unknown
tokens are kept verbatim and in order, stale resume/continue state is stripped
(idempotent across repeated restores), argv0 mismatch falls back to the bare
command. Session IDs come from `session_ids.json`, written by the post-save
hook [`scripts/resurrect-save-sessions.sh`](./scripts/resurrect-save-sessions.sh).

OpenCode caveat: yolo mode (`ocy`) lives in `OPENCODE_CONFIG_CONTENT`, not
argv, so the save hook records that one env var per pane (`opencodeEnv`;
`/proc` environ on Linux, `ps -E` token scan on macOS - space-containing
values unsupported there) and the strategy re-emits it as a single-quoted
inline env prefix. Never persist any other env var - both sources expose the
process's full environment, secrets included.

Tests: [`../zsh/tests/tmux-resurrect-sessions.bats`](../zsh/tests/tmux-resurrect-sessions.bats).

## AI usage tracker (custom subsystem)

The AI usage surfaces track three providers:

- Claude: [`../zsh/functions/claude-usage`](../zsh/functions/claude-usage)
  reads Claude OAuth credentials and caches `~/.cache/claude-usage.json`.
- Codex: [`../zsh/functions/codex-usage`](../zsh/functions/codex-usage)
  reads Codex auth and caches `~/.cache/codex-usage.json`.
- Cosine: [`../zsh/functions/cosine-usage`](../zsh/functions/cosine-usage)
  reads `${COSINE_CONFIG_FILE:-~/.cosine/auth.json}` for `team_id`, gets a
  bearer via `cosine-bearer`, and caches `~/.cache/cosine-usage.json`.

Each provider shares [`../zsh/functions/usage-cache-lib`](../zsh/functions/usage-cache-lib):
`*.meta.json` stores backoff state, `*.lock` prevents concurrent fetches, and
`*.trigger` debounces tmux background refreshes. Do not print bearer/access
tokens in diagnostics.

### Codex window classification

Codex windows are classified by their real `limit_window_seconds`, never by JSON
slot. [`../zsh/functions/codex-windows.jq`](../zsh/functions/codex-windows.jq) is
the shared pure core: it turns a raw Codex usage object into a duration-sorted
`[{seconds, used_percent, reset_after_seconds}]` list (shortest window first),
using the `primary`/`secondary` slot only as a fallback duration when the API
omits `limit_window_seconds`. All three surfaces render that list - the pill and
`codex-usage` shell out to `jq -f`, the fancy dashboard shells out from Python;
`window_label(seconds)` gives canonical `5-hour`/`7-day` (`5h`/`7d`) wording and
adapts to any other duration. Pace/colour maths uses each window's real length.

Why: OpenAI temporarily removed the 5h window (2026-07-12, Plus/Pro/Business) with
no return date, collapsing usage to a single weekly window that arrives in the
`primary_window` slot. Positional classification (primary=5h, secondary=7d)
mislabelled that weekly figure as 5h and forced a false green pill. Duration
classification is adaptive: it renders only the windows that exist and stays
correct whether the 5h window is gone now or returns later, in either slot. Claude
is deliberately left positional - its `five_hour`/`seven_day` keys are named and
contractually fixed, so they can't suffer the same collapse. Spark extras
(`additional_rate_limits`) apply the same duration rule inline (low-stakes, not the
failure mode), not the shared jq.

Surfaces:

- [`scripts/status-right.sh`](./scripts/status-right.sh) renders the compact
  status pill: `C:` Claude windows, `X:` Codex windows, and `S:` Cosine monthly
  credit pool. `S:` keeps the compact `S:<used>%·<reset>` text; its colour uses
  the worse of absolute pool usage and billing-period pace when Cosine provides
  `billingPeriodStartsAt`.
- [`../zsh/functions/agents/ai-usage`](../zsh/functions/agents/ai-usage)
  (`aiu`, popup via `prefix + a`) refreshes providers and renders plain or fancy
  combined usage.
- [`../zsh/functions/usage-debug`](../zsh/functions/usage-debug) prints cache,
  backoff, lock, trigger, and provider usage details.

Tests: [`../zsh/tests/codex-windows.bats`](../zsh/tests/codex-windows.bats)
(the classifier's combinatorial matrix),
[`../zsh/tests/claude-usage.bats`](../zsh/tests/claude-usage.bats),
[`../zsh/tests/codex-usage.bats`](../zsh/tests/codex-usage.bats),
[`../zsh/tests/cosine-usage.bats`](../zsh/tests/cosine-usage.bats),
[`../zsh/tests/ai-usage.bats`](../zsh/tests/ai-usage.bats),
[`../zsh/tests/status-right.bats`](../zsh/tests/status-right.bats), and
[`../zsh/tests/usage-debug.bats`](../zsh/tests/usage-debug.bats).

## Memory-pressure monitoring (custom subsystem)

macOS-only memory gauge, parallel in shape to the agent dots: one shared lib and
three surfaces speaking one vocabulary — `OK | BUSY | CRITICAL`, encoded as
colour plus glyph plus swap figure or a `▲` pressure-cause marker. Change as a set:

- [`scripts/mem-lib.sh`](./scripts/mem-lib.sh) — **canonical** thresholds
  (`MEM_BUSY_SWAP_MB` / `MEM_CRITICAL_SWAP_MB`), state mapping (`mem_state`),
  the colour/glyph language (`mem_state_colour` / `mem_state_glyph`), and the
  figure-slot cause logic (`mem_cause` / `mem_token` / `MEM_CAUSE_GLYPH`): when
  kernel pressure (not swap) drives a non-OK state the pill shows `▲` instead of
  the swap figure, so amber/red is self-explaining.
  Swap-used is the primary visible signal; macOS pressure level escalates the
  state (it often reads normal while actively swapping) and, when it is the
  driver, names the cause. Sourced, never run.
  On Linux the macOS sysctls are absent → swap 0, pressure 1 → flat `OK`.
- [`scripts/status-right.sh`](./scripts/status-right.sh) — `mem_segment()`, the
  quiet-when-healthy pill (width ≥ 80 only). The tmux-cpu RAM% pill
  (`ram_percentage()`, bright-mauve) renders **alongside** it by design — both
  are wanted: RAM% is the total-used headline, mem_segment the swap/pressure
  signal.
- [`scripts/mem-popup.sh`](./scripts/mem-popup.sh) — `prefix + Alt+m` drill-down
  (swap/RAM breakdown, top apps by `phys_footprint`, agent panes). `k`/`r`/`q`.
- [`../zsh/functions/macos/memwatch`](../zsh/functions/macos/memwatch) — launchd
  notifier (desktop-only, [`darwin-desktop.nix`](../nix/modules/darwin-desktop.nix)).
  Banners on sustained pressure; log `~/.cache/memwatch.log`. Reload after edits:
  `launchctl kickstart -k "gui/$(id -u)/dev.connorads.memwatch"`.

Tests: [`../zsh/tests/mem-lib.bats`](../zsh/tests/mem-lib.bats) (lib vocabulary)
and the RAM/mem pills in [`../zsh/tests/status-right.bats`](../zsh/tests/status-right.bats).
Keep the gauge legend in [`help.md`](./help.md) in sync with the lib. The popup's
own awk and the `memwatch` notifier are not yet unit-tested.
