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

Pick a free key with `tmux-freekeys`, the free-key/conflict advisor: it
reports free vs used keys per table against the *running* server, so it sees
plugin-injected binds a tmux.conf grep can't, and flags terminal aliasing
(`C-i≡Tab`, `C-m≡Enter`, `C-h≡BSpace`, `C-[≡Escape`). `tmux-freekeys check <key>
[table]` answers "is this taken, and by what?".

Verify a binding before committing: live-test on a throwaway server
(`tmux -L test new-session -d; tmux -L test source-file <(grep '^bind ...' tmux.conf); tmux -L test list-keys -T prefix | grep '<desc>'`),
or `tmux source-file ~/.config/tmux/tmux.conf` to reload the running server.

## Agent state dots (custom subsystem)

Window tabs show a per-window dot for the *worst* agent state across their panes.
The logic is spread across several files — change them as a set:

- [`scripts/agent-state.sh`](./scripts/agent-state.sh) — sets `@agent_state` per
  pane, rolls the worst up to `@win_agent_state`. Verbs:
  `working|blocked|done|unread|idle|seen|clear|name|unname`. `unread` is the manual
  inverse of `seen` (force `done` even on the focused window — mark a read tab blue
  again). `done` is **seen-at-birth**: if you are already viewing the pane when it
  finishes (`is_viewing` — the sweep's gate: active pane / active window /
  attached session) it goes straight to idle; otherwise blue until you focus it.
  `name`/`unname` set/drop `@agent_name`, a user-set pane label (grammar
  `[a-z][a-z0-9_-]{0,31}`, unique among live agents — enforced by the `agent`
  CLI). Invariant: `@agent_name ⟹ @agent_state` (`name` refuses a stateless
  pane), so the sweep's state-gated death-clear always covers the name; `clear`
  drops it too. Not journalled (the schema has no name field). Shown on the pane
  border (blue `⟪name⟫`) and as a column in the popup/`agent ls`.
- [`scripts/agent-journal.sh`](./scripts/agent-journal.sh) — sourced by
  `agent-state.sh` (phase 0): captures each hook's stdin payload and appends a
  **curated** JSONL event (ts/pane/window/state/kind + session_id, cwd,
  permission_mode, notification message, tool_name, stop_reason — plus `tool_input` for
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
  *finite* work (`workflow|subagent`) in the payload's `background_tasks`
  and forwards `working` while any remain, else `done` (degrades to `done` if jq
  is missing/the payload won't parse). Persistent watchers (`monitor`, `dream`)
  are excluded so they can't pin the dot at working forever; `shell` is excluded
  for the same reason — background shells are often never-exiting dev servers,
  and a false `working` never self-corrects, whereas a finite build showing
  `done` early does (its completion wakes a fresh turn that re-fires the hooks).
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
- [`scripts/agent-cli-lib.sh`](./scripts/agent-cli-lib.sh) — functional core
  shared by the `agent` CLI and [`scripts/agent-popup.sh`](./scripts/agent-popup.sh):
  the target resolver (`%N` | `session:win.pane` | exact `@agent_name`) and
  `agent_list_rows`, the **single agent-pane enumerator** (positional TSV:
  session → window → pane; `cycle` consumes it directly). Attention ranking is
  `agent_rank_sort`, a filter applied at the consuming edge (the popup's list,
  `agent ls`) that injects the canonical `rank()` from agent-state-lib.sh.
  `agent_name_taken` (the live-uniqueness check) lives here too, scoped to the
  enumerator's state-carrying view. Sourced, never executed.
- `agent` CLI ([`../zsh/functions/agents/agent`](../zsh/functions/agents/agent),
  on PATH via `~/.local/bin`) — the scripting front-end so one agent can drive
  others: `ls`/`state`/`wait` (poll `@agent_state`), `prompt` (gated
  buffer-paste + separate Enter + stall verify with one submit retry), `name`/`unname`,
  `pick`. It never writes `@agent_state` directly — all mutation goes through
  `agent-state.sh`; `prompt` only sends keystrokes and observes the option the
  agent's own hooks set.
- Navigation: `prefix + A` popup (fzf pick) and `prefix + Alt+a` cycle-jump
  (`agent-popup.sh cycle blocked,done` — a CSV state priority list, positional
  order within a state, wraps; the fallback-to-done policy is the binding's
  list, not cycle's. The visited pane is aged seen like any jump).

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
- [`../zsh/tests/agent-popup.bats`](../zsh/tests/agent-popup.bats) — list ranking,
  the name column, jump's move + seen ageing, cycle order/wrap/fallback.
- [`../zsh/tests/agent-cli.bats`](../zsh/tests/agent-cli.bats) — the `agent` CLI:
  resolver, enumerator, ls/state/wait against a private server; prompt send
  mechanics + stall/refusal via a PATH tmux stub; name uniqueness.

Keep the dot legend in [`help.md`](./help.md) in sync with `@agent_dotfmt`.

## Resurrect agent-session restore (custom subsystem)

tmux-resurrect restores Claude/Codex/OpenCode panes via the custom strategies in
[`strategies/`](./strategies/) (synced into the plugin dir by a `run-shell cp`
in [`tmux.conf`](./tmux.conf)). Session IDs come from `session_ids.json`, keyed
by pane (`session:window.pane`), written by the post-save hook
[`scripts/resurrect-save-sessions.sh`](./scripts/resurrect-save-sessions.sh).

**Identity is resolved inside the restored pane, not at eval time (Claude/Codex).**
The strategy emits a *launcher* invocation
([`scripts/resurrect-claude-launch.sh`](./scripts/resurrect-claude-launch.sh),
[`scripts/resurrect-codex-launch.sh`](./scripts/resurrect-codex-launch.sh),
absolute path) carrying the kept flags; the launcher runs in the pane and reads
its own pane key from `$TMUX_PANE` (`tmux display-message -pt "$TMUX_PANE"`),
looks up `session_ids.json`, and `exec`s `claude … --resume <id>` /
`codex resume <id> …`. This is exact and client-independent: `$TMUX_PANE` is
unambiguous in every pane, so a wrong-pane resume is structurally impossible.
The strategy must **not** resolve the session itself - the old eval-time
`display-message` read reported *global* active-pane state, which resolves to the
last-active pane when no client is attached (continuum/auto-restore) and races
even interactively, collapsing multiple panes onto one conversation.

Safe cwd fallback: on an exact-key miss the launcher resumes only when *exactly
one* recorded `.panes[]` entry has `.dir == $PWD`; 0 or >1 → `--continue` /
`--last`, never a guessed resume. Because resolution is now exact, no save-time
disambiguation is needed - the save hook just records `.panes[$key] = {dir,
claude|codex, claudeConfigDir?}`.

**Fidelity rule**: the launcher preserves the flags from the *saved pane argv*
(`$1`, from `ps -o args=`) rather than resuming with a bare `<agent> --resume
<id>` - none of the CLIs persist permission mode / system-prompt append / model
in the session, so dropping the flags would restore a gated pane. The strategy
filters them via `resurrect_argv_{claude,codex}_flags` in
[`scripts/lib/resurrect-argv.sh`](./scripts/lib/resurrect-argv.sh): unknown
tokens kept verbatim and in order, stale resume/continue state stripped
(idempotent across repeated restores), argv0 mismatch → bare saved command.

Claude multi-account caveat: a client pane runs under
`CLAUDE_CONFIG_DIR=~/.claude-profiles/code/<name>` (set by `ccp`), invisible in
argv, so the save hook records that one var per pane (`claudeConfigDir`). It reads
it from the live claude PID's real environment via the shared
`claude_config_dir_for_pid` in
[`scripts/lib/agent-session.sh`](./scripts/lib/agent-session.sh) (`/proc` environ
on Linux, `ps -E` token scan on macOS - env introspection is authoritative and
never stale). The launcher `export`s it before `exec` (a real env var, so
spaces/quotes need no shell quoting). Without it a restored client pane reverts to
the personal `~/.claude` account - a cross-billing risk. Only `CLAUDE_CONFIG_DIR`
is persisted; never any other env var - both sources expose the process's full
environment, secrets included.

Account-awareness is not only a restore concern. The **branch/fork** path
(`prefix + Alt+b`, [`scripts/claude-branch-menu.sh`](./scripts/claude-branch-menu.sh))
and the **resurrect save** hook both resolve the pane's account through the same
`claude_config_dir_for_pid`, matching the restore path. A profile pane's live
session lives under `<config_dir>/sessions/<pid>.json` and
`<config_dir>/projects/`, so the resolver
([`scripts/claude-session-resolve.py`](./scripts/claude-session-resolve.py)) takes
`--config-dir` (default `~/.claude`) and reads the registry / open-transcript /
content-match candidates from there. The fork command carries the account inline
as `CLAUDE_CONFIG_DIR=<dir> claude <source-flags> -r <sid> --fork-session` (tmux
panes don't inherit the source pane's env), so a branched pane runs under the
same account as its source rather than silently reverting to `~/.claude`.

The fork also **mirrors the source pane's launch flags** (append, model, perm
mode), read from its live argv (`ps -o args=`) through the same
`resurrect_argv_claude_flags` the restore path uses - so a fork of a non-yolo `c`
pane stays non-yolo, and a `cy`/`ccp` source carries its system-prompt append.
The lib strips the source's own stale `-r`/`--fork-session`/`--continue`, so a
fork-of-fork is clean; a source with no override (bare `claude --resume <id>`)
forks bare. The origin launchers themselves - the `c`/`cy`/`cyc`/`cspy` aliases
and `ccp` - no longer re-type the flag set: it lives once in the shared
[`claude-launch-flags`](../zsh/functions/claude-launch-flags) owner, which they
word-split.

With the config dir restored, the launcher then re-materialises the profile's
shared user config (settings + `CLAUDE.md` memory) via
[`claude-profile-materialise`](../zsh/functions/claude-profile-materialise) - the
same helper `ccp`'s launcher runs - so a resumed account inherits the current
shared `statusLine`/`hooks`/`permissions` rather than whatever was last
materialised. Guarded on the helper being present (`-x`); it fails open without
jq or a shared base.

OpenCode is left on the eval-time strategy (no launcher): it has no live
active-session marker, so it still uses the per-dir cwd map (single live pane
per cwd) and re-emits its `OPENCODE_CONFIG_CONTENT` (`opencodeEnv`, yolo mode
via `ocy`) as a single-quoted inline env prefix. Same secret rule - never
persist any other env var. Follow-up: give OpenCode a launcher too once it grows
a passive marker.

Because launcher resolution is client-independent, `@continuum-restore`
(currently `off`) could be enabled for reliable auto-restore after a crash - the
old eval-time mechanism could not support it. Left as a separate decision.

Tests: [`../zsh/tests/tmux-resurrect-sessions.bats`](../zsh/tests/tmux-resurrect-sessions.bats).

## AI usage tracker (custom subsystem)

The AI usage surfaces track three providers:

- Claude: [`../zsh/functions/claude-usage`](../zsh/functions/claude-usage)
  reads Claude OAuth credentials and caches `~/.cache/claude-usage.json`.
  Multi-account: `--profile <name>` reads a `~/.claude-profiles/code/<name>`
  account (config-dir file first, then the hash-suffixed keychain service) into
  `~/.cache/claude-usage-<name>.json`, stamped with `_label`/`_profile`; `--all`
  fans the default account plus every profile out in parallel. The `prefix + a`
  popup (`ai-usage --fancy`) renders one labelled Claude group per account;
  column 1 is always the owner, so model-scoped weekly windows are
  account-labelled too, with the model folded into the window token (`7d·S`
  Sonnet, `7d·F` Fable) to stay distinguishable across accounts. The compact
  status pill stays default-account only. Accounts are launched with `ccp`.
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
- [`scripts/mem-popup.sh`](./scripts/mem-popup.sh) — `prefix + Alt+m` bounded
  triage (top 5 sampled `phys_footprint` apps + 3 agents). `k` chooses a visible
  app then a process before handing to `pclose --pid`; `a`/`g` open scrollable
  sampled-app/all-agent details; `r` refreshes and `q` closes.
- [`../zsh/functions/macos/memwatch`](../zsh/functions/macos/memwatch) — launchd
  notifier (desktop-only, [`darwin-desktop.nix`](../nix/modules/darwin-desktop.nix)).
  Banners on sustained pressure; log `~/.cache/memwatch.log`. Reload after edits:
  `launchctl kickstart -k "gui/$(id -u)/dev.connorads.memwatch"`.

Tests: [`../zsh/tests/mem-lib.bats`](../zsh/tests/mem-lib.bats) (lib vocabulary)
and the RAM/mem pills in [`../zsh/tests/status-right.bats`](../zsh/tests/status-right.bats).
Keep the gauge legend in [`help.md`](./help.md) in sync with the lib. The popup's
own awk and the `memwatch` notifier are not yet unit-tested.

## Resurrect save freshness (custom subsystem)

Same one-lib-many-surfaces shape as the memory gauge, for a different failure:
**detecting when session saving silently stops.** continuum advances its
save-timestamp unconditionally every 5 min, so a save path that stops producing
files ticks on without error — it did exactly that for 3.5 weeks (saves froze at
28 Jun) until a kernel panic found no recent session to restore. The write path
was healthy; the *silence* was the bug. This subsystem makes save-freshness a
visible, alarming state.

Vocabulary: `FRESH | AGING | STALE | NONE`, from the age of the newest save file.

- [`scripts/resurrect-lib.sh`](./scripts/resurrect-lib.sh) — **canonical**
  thresholds (`RESURRECT_AGING_SECS` 10 min / `RESURRECT_STALE_SECS` 15 min,
  env-overridable for tests), the save-dir resolver (`resurrect_dir`, replicating
  the plugin's `helpers.sh` default), newest-save age (`resurrect_newest_age_secs`
  — max mtime over `tmux_resurrect_*.txt` plus the `last` symlink *target*,
  `_resurrect_mtime` dereferencing with `-L` and handling GNU/BSD `stat`), the
  state mapping (`resurrect_state`), and the colour/glyph/token language
  (`resurrect_state_colour` green/yellow/red, `resurrect_state_glyph` ⟳ turning /
  ⚠ wrong, `resurrect_token` age / `stale` / `none`). Sourced, never run.
  Cross-platform (no macOS-only syscalls), so it works on Linux hosts too.
  Caveat: tmux-resurrect only keeps a timestamped file when session state changed
  since the previous save, so `age` is the age of the last *content-changing*
  save — exactly the signal that went stale in the incident.
- [`scripts/status-right.sh`](./scripts/status-right.sh) — `resurrect_segment()`,
  the always-shown pill (width ≥ 80). Unlike the quiet-when-healthy mem pill, a
  live green `⟳ 2m` is wanted as the running-confidence signal the incident
  lacked; it reddens to yellow/red the moment saving stops. Placed between the AI
  pill and the cpu pill — the one slot where its surface1 (`#45475a`) shade isn't
  adjacent to another surface1 pill (mem/disk/git), so it stays a distinct
  segment.
- [`scripts/resurrect-keepalive.sh`](./scripts/resurrect-keepalive.sh) — the
  **drive** layer (macOS): an independent save driver run every 5 min by a
  launchd agent (`dev.connorads.tmux-resurrect-save`, defined in
  [`darwin-shared.nix`](../nix/modules/darwin-shared.nix), both Macs), so saving
  depends on launchd rather than continuum's status-refresh-injected autosave.
  It runs `save.sh quiet` capturing exit code + stderr to
  `~/.cache/tmux-resurrect-keepalive.log` (the opposite of continuum's
  `>/dev/null 2>&1`), then verifies freshness via the lib: on `STALE`/`NONE` it
  sets the `@resurrect_stale` tmux option and nags each attached client by name
  (`display-message -c` — from launchd there is no current client, so an
  untargeted message would no-op), else clears the flag. No tmux server ⇒ logs
  `no server, skip` and exits 0. continuum stays enabled as cross-platform
  redundancy (Linux hosts get the detect pill but no keepalive yet — a deferred
  systemd-timer follow-up); the minor double-save on macs is harmless.

Restore stays manual (`prefix + Ctrl-r`); `@continuum-restore` is deliberately
`off` (see the resurrect agent-session restore subsystem above).

Tests: [`../zsh/tests/resurrect-lib.bats`](../zsh/tests/resurrect-lib.bats)
(state transitions across the age bands via threshold overrides + aged files,
colour/glyph/token, `last`-target deref) and
[`../zsh/tests/resurrect-keepalive.bats`](../zsh/tests/resurrect-keepalive.bats)
(integration: drives a real save against a throwaway default-socket server, the
skip/alarm/clear/error-capture paths). The pill itself is verified manually
(`status-right.sh 200 "$HOME" "" "" ""`, then `touch -t` an aged save and re-run).
