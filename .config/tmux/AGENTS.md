# AGENTS.md - tmux config

## Interpreter contract: every bash script here runs under bash >= 5

**Invariant: a script behaves identically whichever interpreter the caller's PATH
happens to supply.**

`#!/usr/bin/env bash` resolves through the caller's `PATH`, and in the tmux
server's `PATH` `/bin` precedes the nix profiles. macOS's `/bin/bash` is 3.2.57
(2007): no `mapfile`, no `declare -A`, and a `${var//\'/…}` replacement that
silently produces a *wrong* value. So the interpreter was ambient and unpinned,
and tmux handed these scripts a shell that could not run them.

Two halves, because you cannot `exec` a sourced file:

- **Entry points re-exec.** Every executable file with an `#!/usr/bin/env bash`
  shebang under [`scripts/`](./scripts/), [`strategies/`](./strategies/) and
  [`save_command_strategies/`](./save_command_strategies/) carries the inline
  `bash5 re-exec preamble` block verbatim. It must stay 3.2-parseable and sit
  **above `set -u`** (bash < 4.4 treats `"$@"` with zero args as unbound).
- **Libs assert.** Everything under [`scripts/lib/`](./scripts/lib/) is sourced,
  so it instead asserts `BASH_VERSINFO[0] >= 5` and fails loudly. The rule keys
  on the `lib/` directory, not a shebang, because `lib/claude-plan.sh` has none.

`#!/bin/sh` and `#!/usr/bin/env sh` files are **exempt** - they are genuinely
POSIX-clean. The rule keys on the **shebang, not the `.sh` extension**.

Three details that are load-bearing, not tidiness:

- **`unset TMUX_BASH5_REEXEC` on the success path.** The guard exists only to
  stop an exec loop, and must never be inherited. Otherwise
  [`scripts/resurrect-post-save.sh`](./scripts/resurrect-post-save.sh) re-execs to
  bash 5, then `run_step` spawns
  [`scripts/resurrect-save-sessions.sh`](./scripts/resurrect-save-sessions.sh) as a
  **child process** whose own `env bash` is still 3.2 - the child inherits the
  guard, skips its own re-exec and dies, and `run_step` only `log_warn`s while the
  script `exit 0`s. Silent, which is precisely the 3.5-week failure shape the save
  freshness subsystem below exists to catch. Regression test:
  `post-save hook does not suppress its child's own bash5 re-exec` in
  [`../zsh/tests/tmux-resurrect-post-save.bats`](../zsh/tests/tmux-resurrect-post-save.bats).
- **The `-n guard` branch exits 127** rather than falling through. With the guard
  unset on the success path, a still-too-old interpreter must fail loudly.
- **No version probe on the candidates.** Probing costs an extra bash startup
  each. The candidates are nix paths (5.x by construction - `bash` is declared in
  [`../nix/modules/packages.nix`](../nix/modules/packages.nix)) plus Homebrew as a
  last resort, and the `-n guard` branch turns a bad pick into a loud failure
  rather than a loop.

The preamble is duplicated across ~27 files rather than shared as a sourced lib:
`setup_test_home` deliberately clobbers `$HOME`, so a shared lib would have to be
provisioned into the fake home by every bats file covering an entry point. The
duplication is policed mechanically by the **`bash5-preamble` hk step**
([`../../.hk-hooks/bash5-preamble.py`](../../.hk-hooks/bash5-preamble.py)), so a
new script that omits it cannot be committed. Copying an existing script is
correct by default.

Cost: ~4.5 ms per invocation on macOS, zero on Linux (ambient bash is already
5.x, so no re-exec fires).

Rationale and the rejected alternatives:
<!-- The target exists; rumdl 0.2.40 false-positives on this one link, and only
     in the context of this whole file (every excerpt of it checks clean). -->
<!-- rumdl-disable-next-line MD057 -->
[`../../docs/adr/0001-tmux-scripts-re-exec-under-bash-5.md`](../../docs/adr/0001-tmux-scripts-re-exec-under-bash-5.md).

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

At commit time the `tmux-bind-lint` hk step
([`.hk-hooks/tmux-bind-lint.py`](../../.hk-hooks/tmux-bind-lint.py)) statically
parses [`tmux.conf`](./tmux.conf) and blocks a key bound twice in one key-table
(tmux keeps only the last, so the earlier bind is dead) or both members of a
terminal-alias pair (`C-i≡Tab` etc.) in one table. It is the commit-time
complement to the edit-time `tmux-freekeys` advisor: freekeys queries the
running server (so it sees plugin binds) but only ever shows the *surviving*
bind, whereas the lint reads the source and catches the clobber.

## Popups vs floating panes

**A popup is a transaction; a float is a place you dwell. Default to a float.**

`display-popup` is modal: while one is up the client's keys belong to it, so you
cannot switch windows, navigate panes or answer an agent without discarding the
popup and its state. That cost is highest here precisely because the agent
attention system (dots, the blocked bell, `prefix + A`, the cross-session badge)
exists so you can act the moment an agent needs you - every open popup is a
window in which that is false. Floats (`new-pane`, tmux 3.7+, wrapped by
[`../zsh/functions/tmux/flt`](../zsh/functions/tmux/flt)) are non-modal real
panes: switch away and come back and the tool is still there.

Three blockers force a popup. Nothing else does:

| Blocker | Why |
|---|---|
| Calls `switch-client` / opens a window | A float belongs to a *window*. Switch away mid-selection and the float and its fzf are stranded. |
| Acts on "the pane I came from" | Popups do not change the active pane; **floats become the active pane**, so origin-by-active-pane resolves to the float itself. |
| Must work from any window | Float scope is per-window: a float belongs to the window it was made in, so there is no one summonable scratch. (A window can hold *several* floats - what you cannot have is one that follows you.) |

The second blocker is mechanically removable: `run-shell` format-expands its
command before running it (`man tmux`, run-shell: *"Before being executed,
shell-command is expanded using the rules specified in the FORMATS section"*),
so a float binding can pass `#{pane_id}` explicitly and the script takes the
origin as an argument - see `prefix + Alt+w` and `wt-window.sh pane <path>
[origin]`. `display-popup` cannot do this reliably, which is why the popup
callers resolve the origin live instead.

Every float goes through `flt`, the single door carrying the tmux#5327 unzoom
guard; presets live there, so bindings never spell out geometry. Floats are
drag-resizable, so per-binding sizes are not worth the divergence - `big` unless
there is a reason.

**A float can hold a resident, not just a glance.** Float work comes in three
kinds, and the doctrine above names only two of them. A transaction is picked
and acted on (`prefix + A`). A glance is opened and closed (`prefix + g`
lazygit, 333 uses). A *resident* stays for days: an agent session forked by
`prefix + Alt+b` (143 uses), a scratch shell you typed `claude` into. Residents
are opened into glance containers, so every float needs a door out as well as
in; without one a long-running agent is stranded in the pane it started in.

`unflt` ([`../zsh/functions/tmux/unflt`](../zsh/functions/tmux/unflt)) is that
door, and the mirror of `flt`: it joins a float back to a tiled pane of the same
window, and `prefix + *` calls it when the active pane is floating. What tmux
3.7b allows, verified on a private socket:

| Direction | 3.7b | Mechanism |
|---|---|---|
| float -> tiled, same window | works | `join-pane -s <float> -t <tiled>` |
| float -> its own window | works | `break-pane`, i.e. stock `prefix + !` |
| tiled -> float | not possible | `move-pane` has no `-X`/`-Y`; `new-pane` only creates |

So there is no toggle to build: `unflt` is one-way because tmux is. Revisit
tiled -> float on 3.8, alongside the resurrect limitation below.

**The join destination has to be filtered.** A window can hold several floats,
so `-t :.+` can land on another one and fail with `size or position can't split
a floating pane`. Name a non-floating pane instead:
`tmux list-panes -F '#{pane_id}' -f '#{!:#{pane_floating_flag}}' | head -1`.

These bindings must stay popups, with the blocker each hits:

| Binding | Blocker |
|---|---|
| `prefix + S` (and `M-S`) session switch/create | switch-client |
| `prefix + A` agents popup | switch-client |
| `prefix + Alt+Shift+W` worktree picker | focuses / opens windows |
| `prefix + Alt+s` skl loader | injects the pointer into the origin pane |
| `prefix + Alt+v` vox picker | `ctrl-y` pastes the path into the origin pane |
| `prefix + Alt+Shift+I` shotpath remote | pastes the remote path into the origin pane |

`prefix + Alt+g` → `t` (ghfzf triage) stays a popup as a transaction - pick one
thing, act, done - while the `d`/`u` dashboards on the same menu are floats.
The three origin-pane cases above are now unblockable via the `#{pane_id}`
pattern, but each needs its own script change.

**Floats do not survive a resurrect restore as floats.** tmux 3.7 emits a float
in `#{window_layout}` as a trailing `<…>` cell, but `select-layout` rejects that
string (`invalid layout`), and `restore.sh` replays exactly that saved layout.
Verified on a private socket (save a tiled pane + a float, restore, read
`#{pane_floating_flag}`): every pane comes back, with its command and cwd, as an
ordinary tiled pane. Nothing is lost but the floatness and the geometry. This
exposure predates the popup→float migration - it comes with any float binding -
and is a tmux limitation to revisit on 3.8.

## Agent state dots (custom subsystem)

Window tabs show a per-window dot for the *worst* agent state across their panes.
The logic is spread across several files - change them as a set:

- [`scripts/agent-state.sh`](./scripts/agent-state.sh) - sets `@agent_state` per
  pane, rolls the worst up to `@win_agent_state`. Verbs:
  `working|blocked|done|unread|idle|seen|clear|name|unname`. `unread` is the manual
  inverse of `seen` (force `done` even on the focused window - mark a read tab blue
  again). `done` is **seen-at-birth**: if you are already viewing the pane when it
  finishes (`is_viewing` - the sweep's gate: active pane / active window /
  attached session) it goes straight to idle; otherwise blue until you focus it.
  `name`/`unname` set/drop `@agent_name`, a user-set pane label (grammar
  `[a-z][a-z0-9_-]{0,31}`, unique among live agents - enforced by the `agent`
  CLI). Invariant: `@agent_name ⟹ @agent_state` (`name` refuses a stateless
  pane), so the sweep's state-gated death-clear always covers the name; `clear`
  drops it too. Not journalled (the schema has no name field). Shown on the pane
  border (blue `⟪name⟫`) and as a column in the popup/`agent ls`.
- [`scripts/agent-journal.sh`](./scripts/agent-journal.sh) - sourced by
  `agent-state.sh` and `agent-sweep.sh` (phase 0): captures each hook's stdin
  payload and appends a
  **curated** JSONL event (ts/pane/window/state/kind + session_id, cwd,
  permission_mode, notification message, tool_name, stop_reason - plus `tool_input` for
  `ExitPlanMode` only, i.e. the plan text) to
  `~/.local/state/agent-journal/events-YYYY-MM.jsonl`. The dots show current
  state; the journal is the replayable history for audits and future cross-pane
  sequencing. Process acquisition, kind change, and release append a
  metadata-only `ProcessReconcile` event with the reason, prior identity, and
  absence age. Full tool inputs are deliberately not recorded (file contents /
  command lines can carry secrets). Fail-open, needs jq; disable with
  `AGENT_JOURNAL_DISABLE=1`, relocate with `AGENT_JOURNAL_DIR`. Monthly files:
  retention is deleting old months. The **plan viewer**
  ([`scripts/claude-plan-popup.sh`](./scripts/claude-plan-popup.sh) via `prefix +
  T` → "Claude: view plan") is a live *reader* of this journal, not only a
  history consumer: its pure core
  ([`scripts/lib/claude-plan.sh`](./scripts/lib/claude-plan.sh)) takes the latest
  `.plan.planFilePath` per pane (the path encodes the account), gates on *live*
  tmux panes (a reused `%N` only ever shows its current occupant's plan), and
  renders the launching pane's plan straight away or falls back to an fzf picker
  across accounts. No process scraping. Tested by
  [`../zsh/tests/claude-plan-popup.bats`](../zsh/tests/claude-plan-popup.bats).
- [`scripts/agent-state-lib.sh`](./scripts/agent-state-lib.sh) - shared rank,
  pane→window and window→session rollups, bell, and `is_viewing` helpers (also
  used by `agent-sweep.sh`;
  `is_viewing` is the one definition of "you are looking at the pane", shared by
  the `done` branch and the sweep), the codex title-spinner pure core
  (`has_spinner` + `codex_working_step`, the working↔idle FSM the sweep drives),
  **and the canonical state → glyph + colour mapping**
  (`agent_attrs`/`agent_hex`/`agent_char`/`agent_glyph`). **Shape** encodes state as well as colour so it reads on a
  colour clash and for colour-blind use; `working` is peach (not yellow) so it
  clears the same-yellow active-tab text. See [`help.md`](./help.md) for the
  legend. `@session_agent_attention` caches each session's attention-only
  `blocked > done` summary; working/idle deliberately render only on window tabs.
  The bottom rail shows that glyph beside every session, including each session
  containing a linked agent window. Topology hooks call `agent-sweep.sh sync` to
  rebuild both cached levels after pane/window moves. The lib also hosts
  **`other_sessions_badge`** - the read-only cross-session fallback (worst of
  blocked>done + a count of such agent panes in sessions other than the attached
  one), rendered by
  [`scripts/status-right.sh`](./scripts/status-right.sh)'s
  `agent_elsewhere_segment` as a right-side pill below 80 columns. It preserves
  the ambient signal when the session rail is likely to trim, self-hides when
  nothing is elsewhere, and is disabled by
  `tmux set -g @cross_session_badge off`. Semantically aligned with `prefix + A`:
  it counts exactly the panes that popup would jump to elsewhere. Tested by
  [`../zsh/tests/agent-badge.bats`](../zsh/tests/agent-badge.bats).
- [`scripts/agent-stop.sh`](./scripts/agent-stop.sh) - Claude `Stop`/`StopFailure`
  hook adapter. Claude fires `Stop` at every clean turn-end, even while a
  background dynamic workflow / subagent is still draining; turns that end via
  API error fire `StopFailure` instead (`Stop` doesn't fire for those) and route
  through the same adapter. It jq-counts the in-flight
  *finite* work (`workflow|subagent`) in the payload's `background_tasks`
  and forwards `working` while any remain, else `done` (degrades to `done` if jq
  is missing/the payload won't parse). Persistent watchers (`monitor`, `dream`)
  are excluded so they can't pin the dot at working forever; `shell` is excluded
  for the same reason - background shells are often never-exiting dev servers,
  and a false `working` never self-corrects, whereas a finite build showing
  `done` early does (its completion wakes a fresh turn that re-fires the hooks).
- [`scripts/agent-pretooluse.sh`](./scripts/agent-pretooluse.sh) - Codex
  `PreToolUse` hook adapter (sibling of `agent-stop.sh`). Codex's question card is
  the `request_user_input` tool, and unlike Claude's `AskUserQuestion` it fires
  **no** `PermissionRequest` - only `PreToolUse`/`PostToolUse` → `working` - so a
  pane awaiting your answer would sit peach, never red. The adapter jq-inspects
  `tool_name`: `request_user_input` → `blocked`, else `working`, re-piping the
  payload so `agent-state.sh`'s journal capture stays intact. Fail-open to
  `working` if jq is missing or the payload won't parse. Blocked deliberately
  stays on this instant, precise hook (lag on "needs you" is worse than on
  "working"); the codex title poller below is working-only.
  Adapters like this are the general shape, so the wiring contract is a role,
  not a binary: every `~/.codex/hooks.json` agent-state command either invokes
  `agent-state.sh` directly, or an `agent-*.sh` adapter in `scripts/` that
  forwards to it. `codex-agent-hooks.bats` checks that by grepping the adapter,
  so a new adapter needs no test edit - but one that never reaches
  `agent-state.sh` fails the gate.
- [`scripts/agent-sweep.sh`](./scripts/agent-sweep.sh) - phase-5 reconcile net (a
  one-shot on `client-attached` + a per-server daemon polling every `POLL`, 10s).
  Three jobs: (1) reconcile Claude/Codex presence from the pane shell's kernel
  foreground process group; (2) age a `done` dot you are currently viewing
  (`is_viewing`: active pane, active window, `session_attached>0`) to idle - the
  deterministic backstop for the `done` branch's seen-at-birth and the focus
  hooks' `seen`, which they miss when the finish races your focus or you watch one
  agent while another finishes then return by switching windows (no fresh
  select-pane/window-changed). The attached-session gate keeps detached sessions
  unread (nobody looking); (3) **codex title-spinner working detection** - Codex
  has no "model generating" hook event, so a pane the Stop hook aged to idle (or a
  turn resumed without a fresh `UserPromptSubmit`) sits green while actively
  computing. Codex's OSC title carries a braille spinner while working
  (`terminal_title = ["spinner", …]`), which tmux exposes as `#{pane_title}`;
  reading it is allowed because it is **the app's own OSC status broadcast, a
  status channel distinct from screen-body scraping**. The pure FSM
  (`codex_working_step` in `agent-state-lib.sh`) reconciles the spinner to
  `working↔idle`: a spinner corrects idle/done → working; a `working` pane retires
  to idle only after `CODEX_POLL_CONFIRM` (2) consecutive spinner-less polls
  (counted in `@agent_poll_absent`), debouncing the momentary reasoning↔tool gap.
  **Ownership split** (no marker/lease): for codex panes the poller owns
  `working↔idle`, the hooks own `blocked`/`done`, so `blocked` is left alone.
  Precedence stays `blocked > done(unseen) >
  working > idle` (the canonical `rank`). Opt out with
  `tmux set -g @codex_title_poll off` (mirrors `@cross_session_badge off`).
  Presence scans the whole foreground group, so zsh/Python launch wrappers do
  not hide their agent child. Exact argv0 basenames recognise only `claude` and
  `codex`; later arguments never count. A recognised process acquires a missing
  pane as idle and preserves hook-owned activity for the same kind. A shell-only
  group arms `@agent_presence_absent_since`, then clears after 10 continuous
  seconds; failed, ambiguous, or unknown non-shell probes preserve state. Hook
  activity cancels pending absence, and hibernated panes remain process-exempt.
- `@agent_dotfmt` (in [`tmux.conf`](./tmux.conf)) - renders the tab dot from the
  mapping. The popup reads the lib directly (`agent_glyph`); the tabs and the
  menu literals re-encode it and are guarded against drift by `agent-glyphs.bats`.
- Hooks: `~/.claude/settings.json` (and other agents' hooks) call
  `agent-state.sh` on lifecycle events; Claude's `Stop`/`StopFailure` route
  through `agent-stop.sh` (`working` while `background_tasks` holds finite
  in-flight work, `done` once drained), and Codex's `PreToolUse`
  ([`~/.codex/hooks.json`](../../.codex/hooks.json)) routes through
  `agent-pretooluse.sh` (`blocked` on the `request_user_input` question card,
  else `working`). The `after-select-pane` / `session-window-changed` / `client-focus-in`
  hooks fire `seen` (focus = mark read), gated on `#{@agent_state}==done` so idle
  switches pay no fork. They use stable array index 100 so reloads replace rather
  than duplicate them; empty historical indexes 0-2 overwrite the retired forced
  refresh and duplicate seen hooks in long-running servers. Tmux redraws status
  natively on navigation; do not add
  a forced `refresh-client -S` base hook. `client-focus-in` (NOT
  `pane-focus-in`, which is inert as a global hook) catches regaining terminal
  focus without a navigation. `agent-sweep.sh` is the backstop when none of them fire.
- Menus: `prefix + Alt+.` and the right-click pane menu
  ([`scripts/context-menu.sh`](./scripts/context-menu.sh)) set a state by hand
  (literals must match the lib - see `agent-glyphs.bats`).
- [`scripts/agent-cli-lib.sh`](./scripts/agent-cli-lib.sh) - functional core
  shared by the `agent` CLI and [`scripts/agent-popup.sh`](./scripts/agent-popup.sh):
  the target resolver (`%N` | `session:win.pane` | exact `@agent_name`) and
  `agent_list_rows`, the **single agent-pane enumerator** (positional TSV:
  session → window → pane; `cycle` consumes it directly). Attention ranking is
  `agent_rank_sort`, a filter applied at the consuming edge (the popup's list,
  `agent ls`) that injects the canonical `rank()` from agent-state-lib.sh.
  `agent_name_taken` (the live-uniqueness check) lives here too, scoped to the
  enumerator's state-carrying view. Sourced, never executed.
- `agent` CLI ([`../zsh/functions/agents/agent`](../zsh/functions/agents/agent),
  on PATH via `~/.local/bin`) - the scripting front-end so one agent can drive
  others: `ls`/`state`/`wait` (poll `@agent_state`), `prompt` (gated
  buffer-paste + separate Enter + stall verify with one submit retry), `name`/`unname`,
  `pick`. It never writes `@agent_state` directly - all mutation goes through
  `agent-state.sh`; `prompt` only sends keystrokes and observes the option the
  agent's own hooks set. `ls` reconciles once before reading, so a live direct or
  wrapped Claude/Codex appears before its first lifecycle hook; its text and JSON
  schemas are unchanged.
- Navigation: `prefix + A` popup (fzf pick) and `prefix + Alt+a` cycle-jump
  (`agent-popup.sh cycle blocked,done` - a CSV state priority list, positional
  order within a state, wraps; the fallback-to-done policy is the binding's
  list, not cycle's. The visited pane is aged seen like any jump).

Tests (run `mise run zsh-tests`):

- [`../zsh/tests/agent-state.bats`](../zsh/tests/agent-state.bats) - verb
  behaviour + rollup; also the pure `has_spinner` glyph matrix and
  `codex_working_step` FSM (lie/resume/stop-debounce/momentary-gap/blocked cases).
- [`../zsh/tests/agent-pretooluse.bats`](../zsh/tests/agent-pretooluse.bats) - the
  Codex `PreToolUse` adapter: `request_user_input` → blocked, else working,
  fail-open, and payload passthrough to the journal.
- [`../zsh/tests/agent-journal.bats`](../zsh/tests/agent-journal.bats) - journal
  lines: curated fields, ExitPlanMode plan capture, no tool_input leak,
  disable/no-stdin/no-op-seen cases, Stop payload pass-through, and the
  metadata-only process reconciliation schema.
- [`../zsh/tests/tmux-agent-tabs.bats`](../zsh/tests/tmux-agent-tabs.bats) -
  asserts the **exact** `@agent_dotfmt` glyph/colour output against the real
  tmux.conf; update it when you change the state → glyph mapping.
- [`../zsh/tests/agent-glyphs.bats`](../zsh/tests/agent-glyphs.bats) - derives
  expectations from `agent-state-lib.sh` and asserts all four renderers (tabs,
  prefix+Alt+. menu, right-click pane menu, popup) match it; the drift guard
  for the mapping.
- [`../zsh/tests/agent-sweep.bats`](../zsh/tests/agent-sweep.bats) - stale-dot
  clearing + the viewed-`done` → idle reconcile (attached/inactive/detached
  gates) + the codex title-spinner working detection (spinner → working, the
  two-poll retire to idle, done-left-alone, `@codex_title_poll off`).
- [`../zsh/tests/agent-popup.bats`](../zsh/tests/agent-popup.bats) - list ranking,
  the name column, jump's move + seen ageing, cycle order/wrap/fallback.
- [`../zsh/tests/agent-cli.bats`](../zsh/tests/agent-cli.bats) - the `agent` CLI:
  resolver, enumerator, ls/state/wait against a private server; prompt send
  mechanics + stall/refusal via a PATH tmux stub; name uniqueness.

Keep the dot legend in [`help.md`](./help.md) in sync with `@agent_dotfmt`.

## Agent hibernate / thaw (custom subsystem)

Stop an idle Claude or Codex pane to reclaim RAM and swap, park a thawer in its
place, and resume the same conversation on demand. Stopping is what returns memory -
SIGSTOP keeps every page mapped, so it parks the leak rather than resetting it -
and `--resume` restores the conversation in full because the transcript, not the
process, is the session. The lifecycle-specific mechanism and rejected
alternatives live in [`docs/adr/0009`](../../docs/adr/0009-hibernate-agent-panes-through-lifecycle-adapters.md).

- [`scripts/agent-hibernate.sh`](./scripts/agent-hibernate.sh) - the whole
  engine: `hibernate` / `thaw` / `park` / `list`. Identity is snapshotted with
  the same resolvers the restore and fork paths use. Claude keeps its ccp
  account and launch posture. Codex keeps the exact current thread ID, cwd,
  argv boundaries, CLI version and optional `mcpz` bundle name.
- **The record store is keyed by session id**, at
  `~/.local/state/agent-hibernate/<sessionId>.json` (`AGENT_HIBERNATE_DIR`
  relocates it), with the pane's screen capture beside it as
  `<sessionId>.screen.txt`. Pane ids die with the server and pane keys drift on
  a window move, so `pane`/`paneKey` are stored as *current addresses* and
  refreshed - never used as the key. New records also snapshot `windowName`.
  Display labels resolve through agent name → live window name → saved window
  name → pane key → short session id. The fallbacks keep old records readable;
  remove them only when no stored record lacks `windowName`. **No resolvable
  session id means no
  hibernation**: `--continue` would resume whichever conversation the directory
  last touched, which for a directory holding several panes is the wrong one.
- **The state gate.** `idle`/`done` hibernate freely; `blocked` (a pending
  permission prompt), `working` (an in-flight tool call) and an empty state each
  need `--force`, and refusal is **exit 6**.
- **`remain-on-exit` is raised across shutdown.** Both pane shapes occur -
  an agent under a shell, and an agent *as* the pane process - and in the second the
  pane would close on the kill before the thawer could be spawned into it.
- **Codex exits through its TUI lifecycle.** Bounded Ctrl+C presses clear a
  draft or modal and request graceful shutdown. The engine waits for the exact
  PID to exit before parking. A timeout leaves Codex live unless `--force` was
  supplied. Claude retains its process-group TERM/KILL path.
- **The screen is captured before the respawn**, with trailing blank padding
  trimmed. `respawn-pane -k` discards the visible screen and keeps scrolled
  history (observed), so park re-prints the capture; re-printing tmux's
  full-height padding would scroll the content itself off the top.
- **Park gives the pane a title, and that is load-bearing.** `save.sh` parses
  its own dump with `IFS=<tab> read`, and TAB is IFS whitespace, so a pane with
  an **empty** title collapses that line's fields - the pid lands in the title
  slot and the pane saves no command at all (observed: 14 parked panes saved
  bare). `respawn-pane` leaves the title empty, so park sets one over OSC 2,
  not `select-pane -T`, which would be a second tmux call from inside the pane.
  That fix treats the *producer*, so every `IFS=$'\t' read` parse in the
  subsystem is still exposed to the next nullable field. The scripts here hold
  eleven such sites where an interior field can genuinely be empty:
  `lib/claude-plan.sh:98` (a plan's `title`, blank or a bare `#` first line -
  the picker renders shifted columns for an untitled plan);
  `resurrect-save-sessions.sh:213,222` (`#{pane_current_command}`, empty for a
  dead pane, which `remain-on-exit` makes a designed-for state - the pane's dir
  is set to a tty path) and `:339` (`#{pane_current_path}` - a hibernated pane
  drops out of the save); `organiser.sh:204,291,375`
  (`#{pane_current_command}` - "copy pane info" passes an unquoted cwd in the
  cmd slot, and the kill prompt names a directory) and `:155,249,347` (a
  window `label` from `#{b:pane_current_path}` under `automatic-rename`, tmux's
  default - the "kill shared window everywhere" menu names the wrong branch);
  `agent-hibernate.sh:209` (`#{pane_current_path}` - an empty `paneKey` in the
  record); and `mem-popup.sh:132` (`#{window_name}`, spelled
  `IFS="$(printf '\t')"` so a grep for the usual form misses it - 0 MB
  reported). The correct split is `"${(@ps:\t:)rec}"` in zsh and an explicit
  field walk in bash; the mechanism, the repro and the audit method live in the
  `mechanical-enforcement` skill (`references/shell-quality.md`, `## zsh`).
- **Park is a key-loop, not a placeholder.** It re-prints the screen, shows
  `hibernated: <name> (idle Nd, freed NNN MB) - Enter to thaw`, and thaws on
  Enter via `run-shell -b` - server-side, outside the pane's own process group,
  or the respawn would kill park mid-thaw before the record is cleaned up.
- **Idle age comes from the journal** (`last_journal_ts`), grepping only the
  current and previous month's `events-*.jsonl` on demand - those files run
  ~60 MB/month.
- **The sweep exempts `hibernated`, and so does `clear`.** A parked pane's
  foreground IS a bare shell, which is the sweep's "the agent died" signal, so
  without the exemption the dot goes within one poll. `agent-state.sh clear`
  skips a hibernated pane for a related reason: killing claude fires *its own*
  `SessionEnd` hook, which lands mid-park (observed one second before park
  re-armed the state), and a lost dot drops the pane out of the resurrect save.
  Note the sweep daemon parses its script once at start, so a long-lived daemon
  keeps running the code it was launched with - restart it after changing the
  sweep, or the exemption is not in force.
- **Restore survival.** Three pieces keep a parked pane parked across a tmux
  restart: [`resurrect-save-sessions.sh`](./scripts/resurrect-save-sessions.sh)
  rewrites hibernated `session_ids.json` entries fresh from the record store
  each save (the record is the live truth; the carry rule wants a live *agent*
  pane, which a parked pane is not) and refreshes each record's address;
  [`save_command_strategies/foreground.sh`](./save_command_strategies/foreground.sh)
  emits the park invocation for a pane whose record matches, because a parked
  pane's shell foreground would otherwise save no command and `restore.sh`
  drops such pane lines; and `"~agent-hibernate"` in `@resurrect-processes`
  ([`tmux.conf`](./tmux.conf)) stops that command being filtered out. A record
  counts only while its pane still carries `@agent_state=hibernated` - after a
  restart a recycled pane id can name an unrelated pane.
- **Nothing becomes unreachable.** On restore, park resolves through pane id →
  pane key → the `session_ids.json` hibernated entry → a *unique* cwd (the same
  exactly-one rule as `resurrect-claude-launch.sh`), and re-addresses the record
  under the new pane id. Anything unresolvable holds as an **orphan**, which
  `agent thaw`'s picker lists and thaws into a fresh window in the recorded cwd.
- Surfaces: `agent hibernate [target] [--force]` / `agent thaw [target]` (the
  CLI delegates through `AGENT_HIBERNATE_SH` and, as ever, mutates no
  `@agent_state` itself), `prefix + Alt+z` for the current pane,
  `prefix + Alt+Shift+Z` for the global thaw picker, Enter in a parked pane,
  and state-aware lifecycle items in the exact pane's right-click menu.
  [`scripts/agent-hibernate-action.sh`](./scripts/agent-hibernate-action.sh)
  turns engine output into client-targeted status feedback. Window-tab menus
  omit lifecycle actions because a window can contain several agent panes.

Tests: [`../zsh/tests/agent-hibernate.bats`](../zsh/tests/agent-hibernate.bats)
drives a real private server end to end. Its fake claude is a **symlink to a nix
bash** running an idle script, and both halves are load-bearing: `ps -o comm=`
reports a *script's* interpreter (so a shell stub never matches "claude"), and
macOS withholds a SIP-protected binary's environment from `ps -E` (so
`/usr/bin/tail` would read back no `CLAUDE_CONFIG_DIR`). The save-side and
foreground-strategy halves live in
[`../zsh/tests/tmux-resurrect-sessions.bats`](../zsh/tests/tmux-resurrect-sessions.bats).

## Touch organiser (custom subsystem)

The touch workspace organiser is a native tmux menu layer backed by one script:
[`scripts/organiser.sh`](./scripts/organiser.sh). It is opened by `prefix + W`,
right-clicked window tabs, the pane-header `[⋯]` control, the session badge menu
and Remobi's Organise button. [`scripts/context-menu.sh`](./scripts/context-menu.sh)
keeps the worktree popup modes, but delegates pane/window/session menus to the
organiser.

Design rules:

- Gather tmux topology before deciding actions, then perform one mutation path.
  Actions address sessions, windows, panes and clients by stable tmux IDs
  (`$N`, `@N`, `%N`, `#{client_name}`); names are escaped and used only as menu
  labels.
- Destination menus page by `#{client_height}`. Native `display-menu` does not
  scroll; Previous/Next entries are the paging mechanism.
- Relocation uses existing sessions only. Empty destination lists show a disabled
  "No eligible sessions" row rather than creating sessions.
- `Share with session…` means `link-window`: the same live window appears in
  another session. `Remove from this session` is `unlink-window` and is available
  only while `#{window_linked}` is true. Killing a linked window is labelled
  `Kill shared window everywhere`.
- Exclude the source session from move/share destinations; for sharing, also
  exclude sessions already containing the window.
- Confirm any move, unlink, join or kill that closes the source session or acts
  on every linked copy.
- Pane break is disabled when the pane is already the window's sole pane. Pane
  break destinations include the current session so a pane can become a new
  window in place. Joining a marked pane stays on the destination after the join.
- The second status row stays the only bottom row. It contains a native `S:`
  session rail on the left and the existing status-right chrome on the right.
  The rail uses `range=session|#{session_id}`, native list trimming with `<`/`>`
  markers, and attention-only blocked/done dots. The sub-80 cross-session
  fallback badge and memory pill are
  `range=user|agents` / `range=user|mem`; `MouseDown1Status` handles those and
  falls back to tmux's stock `switch-client -t =` for every other status click.
- Pane-header `[⋯]` and `[zoom]` are tmux control ranges (`control|7` and
  `control|8`). Kill remains inside the menu.

Tests:
[`../zsh/tests/organiser.bats`](../zsh/tests/organiser.bats) covers destination
filtering, pagination, escaped labels, linked-window labelling, sole-pane break
constraints and marked-pane join directions. [`../zsh/tests/context-menu.bats`](../zsh/tests/context-menu.bats)
covers context-menu delegation plus the retained worktree popup modes.
[`../zsh/tests/tmux-agent-tabs.bats`](../zsh/tests/tmux-agent-tabs.bats) guards
the status/control ranges, and [`../zsh/tests/status-right.bats`](../zsh/tests/status-right.bats)
guards the tappable memory range. Keep [`help.md`](./help.md) in sync with any
control or binding change.

## Resurrect agent-session restore (custom subsystem)

tmux-resurrect restores Claude/Codex/OpenCode panes via the custom strategies in
[`strategies/`](./strategies/) (synced into the plugin dir by a `run-shell cp`
in [`tmux.conf`](./tmux.conf)). Session IDs come from `session_ids.json`, keyed
by pane (`session:window.pane`), written by the post-save hook
[`scripts/resurrect-save-sessions.sh`](./scripts/resurrect-save-sessions.sh).
The hook target is [`scripts/resurrect-post-save.sh`](./scripts/resurrect-post-save.sh):
it always attempts both Nix-path stripping and session-map saving, and logs
non-fatal companion failures to `~/.cache/tmux-resurrect-post-save.log`.

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

**`session_ids.json` is merged, not rewritten.** A live agent pane can resolve to
nothing - the agent is still starting, it sits at Claude's "Do you trust this
folder?" prompt (no `<config_dir>/sessions/<pid>.json` yet), or `ps` misses it
once - and a save built from its own findings alone would delete that pane's id
and account, downgrading the restore to a `--continue` that also drops the ccp
account (a cross-billing risk). So each save carries an entry it cannot confirm
while its pane key still holds a live agent pane whose *current* cwd equals the
recorded `.dir`, and this save's fresh findings overlay the carried map. Dead and
moved keys are pruned by the same rule, so the file stays self-cleaning and the
save idempotent; it is removed only when nothing resolves and nothing is
carryable. The legacy top-level per-dir keys (OpenCode's single-pane-per-cwd
fallback) are deliberately rebuilt from live findings rather than carried - their
whole value is being live.

**Codex ids need `lsof`, so the lookup does not rely on `PATH` alone.** Claude
publishes a per-PID registry file, but Codex's thread id is only discoverable from
the rollout transcript the process holds open, which `codex_session_file_for_pid`
finds with `lsof`. macOS keeps `lsof` in `/usr/sbin`, a dir a launchd agent's
`PATH` carries only if its plist lists it - and the hook fails open on a missing
tool, so a `PATH`-only lookup recorded *no* Codex id at all while Claude panes
kept resolving. `agent_lsof_command` therefore falls back to `/usr/sbin/lsof`
(`AGENT_LSOF_FALLBACK` overrides for tests), and the keepalive plist lists
`/usr/sbin` too - defence in depth, since either alone closes the gap.

**Every pane running an agent is saved with a command.** The `foreground`
save-command strategy
([`save_command_strategies/foreground.sh`](./save_command_strategies/foreground.sh),
selected by `@resurrect-save-command-strategy` and copied into the plugin's own
`save_command_strategies/` by the same `run-shell cp` as the restore strategies)
keeps upstream's child-of-`pane_pid` scan as its primary, then falls back to the
pane's *foreground* process. Upstream's ppid-only scan misses a pane whose top
process **is** the agent - `tmux split-window '<cmd>'` (the branch/fork menu) has
the shell exec the command, so there is no child to find - and `restore.sh`
filters pane lines whose full-command field is empty *before* any restore
strategy runs, so such a pane silently returns as a bare shell however good the
strategy is. The fallback asks tmux for the pane's tty and foreground command,
leaves shells empty (an idle shell pane must save no command), and resolves the
PID through the same `agent_foreground_pid_for_tty` the session-id hook uses, so
both halves of the subsystem agree on how to find a pane's agent - by tty, which
also covers a re-parented/grandchild agent. A missing copy in the plugin dir
fails open to the bundled `ps` strategy.

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

The branch menu can also **fork into a *different* account** ("Fork → other
ACCOUNT"), to shift billing or dodge a rate limit mid-chat. Account is modelled
as a **mode that composes with every placement**, not a placement of its own:
the branch menu has two orthogonal axes - *placement* (split / window / worktree
/ ×N) and *account* (source / other) - and the source render offers the full
placement palette for the pane's own account plus a single "other ACCOUNT" row.
Picking it chains (menu → `run-shell` → menu, the same idiom the whole branch
menu uses) into `account-menu`: a `display-menu` of the *other* accounts
(`account_candidates` - default + each ccp profile, the source excluded), titled
by the source account so its own absence is self-explaining. Choosing one lands
in `account-chosen`, which stages the source session in the target account
(`stage_session_for_fork`), materialises the target profile's shared config, then
**re-renders the same placement palette for the target account**
(`render_branch_menu`, `with_account=0` so there is no further account hop).
Claude sessions are normally one transcript under `projects/<slug>/`. An active
plan-mode session also has a plan sidecar referenced by the transcript. The
staging step copies that non-empty sidecar under the target's `plans/`
directory before showing the placement menu. It does not rewrite the transcript
or plan metadata. Native `--fork-session` reads the copied `<sid>` and staged
plan under the target dir, mints a fresh id, and clones the plan to the fork's
fresh slug. A missing, unsafe, malformed, or colliding plan is best-effort: tmux
shows the concrete warning and marks the placement menu `plan not copied`, while
transcript-only forking remains available. Transcript copying remains
mandatory.

Every placement forks under `CLAUDE_CONFIG_DIR=<target>`, so **the origin is left
running untouched under the source account** - different files in different
config dirs, no session-lock conflict. The slug maths / candidate listing /
staging are the executable-free
[`scripts/lib/claude-account.sh`](./scripts/lib/claude-account.sh)
(`claude_account_slug` mirrors `project_slug` in `claude-session-resolve.py`).
The copied base transcript lingers harmlessly as a branch-point session under
the target account.

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

[`scripts/codex-branch-menu.sh`](./scripts/codex-branch-menu.sh) does the same
through `resurrect_argv_codex_flags`, so a plain `cx` source forks sandboxed and
only a `cxy` source carries `--dangerously-bypass-approvals-and-sandbox`.

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

### Handoff carries posture, it never chooses it

The **invariant across every new pane** - fork, restore, and handoff - is that a
new pane has no more authority than the one it came from, and never silently
less. The handoff rows (`Handoff → Claude` / `Handoff → Codex`) are bound by it
too, which fixes a pane that used to open with *nothing*.

The boundary between the two halves:

- **The menu owns authority**, decided from the live source pane's argv
  (`ps -o args=`) - the exact launch authority, next to a living witness. Not
  from the transcript: Claude's `permissionMode` is the shift-tab UI state (a
  quarter of substantive sessions end in `plan` despite launching yolo), and
  `handoff`'s `resolve_input` accepts any existing path, so inferring there would
  mean taking launch authority from an input file.
- **`handoff` only forwards.** One dumb seam -
  `HANDOFF_{CLAUDE,CODEX}_OPEN_ARGS`, appended verbatim to the resume argv before
  the resume token - mirroring its existing `HANDOFF_{CLAUDE,CODEX}_BIN`
  override. It never invents a flag. See
  [`~/src/handoff/README.md`](../../src/handoff/README.md).
- **Only the posture boolean crosses agents.** The menus translate
  `--dangerously-skip-permissions` ↔ `--dangerously-bypass-approvals-and-sandbox`
  and forward nothing else: `--model` and `-c key=val` are meaningless in the
  other CLI. Claude's interactive baseline (the system-prompt append) is added by
  the [`handoff`](../zsh/functions/agents/handoff) wrapper from the same
  `claude-launch-flags` owner, not re-typed by the menu.

Not durable across a *second* hop: `formats/claude.py` writes
`"permissionMode": "default"` on user lines and the Codex writer emits no
`turn_context`, so a handed-off session's *stored* posture is still wrong. Fixing
that is a writer change with a byte-parity cost.

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
  Sonnet, `7d·F` Fable) to stay distinguishable across accounts. Accounts are
  launched with `ccp`.
- Codex: [`../zsh/functions/codex-usage`](../zsh/functions/codex-usage)
  reads Codex auth and caches `~/.cache/codex-usage.json`.
- Cosine: [`../zsh/functions/cosine-usage`](../zsh/functions/cosine-usage)
  reads `${COSINE_CONFIG_FILE:-~/.cosine/auth.json}` for `team_id`, gets a
  bearer via `cosine-bearer`, and caches `~/.cache/cosine-usage.json`.

Each provider shares [`../zsh/functions/usage-cache-lib`](../zsh/functions/usage-cache-lib):
`*.meta.json` stores backoff state and `*.lock` prevents concurrent fetches. Do
not print bearer/access tokens in diagnostics.

### Codex window classification

Codex windows are classified by their real `limit_window_seconds`, never by JSON
slot. [`../zsh/functions/codex-windows.jq`](../zsh/functions/codex-windows.jq) is
the shared pure core: it turns a raw Codex usage object into a duration-sorted
`[{seconds, used_percent, reset_after_seconds, reset_at}]` list (shortest window
first). A window the API gives no `limit_window_seconds` for reports `seconds: 0`,
meaning unknown - the slot's usual length is never substituted, because doing so
reproduces the positional bug one layer down. **No surface may name a window a
duration the payload does not support.** Both surfaces render that list -
`codex-usage` shells out to `jq -f`, while the fancy dashboard shells out from
Python; `window_label(seconds)` gives canonical `5-hour`/`7-day` (`5h`/`7d`)
wording, `unknown`/`?` for a 0, and adapts to any other duration. Pace/colour
maths uses each window's real length, and skips a window whose length is unknown.

Why: OpenAI temporarily removed the 5h window (2026-07-12, Plus/Pro/Business) with
no return date, collapsing usage to a single weekly window that arrives in the
`primary_window` slot. Positional classification (primary=5h, secondary=7d)
mislabels that weekly figure as 5h. Duration classification is adaptive: it
renders only the windows that exist and stays correct whether the 5h window is
gone now or returns later, in either slot. Claude stays positional because its
`five_hour`/`seven_day` keys are named and contractually fixed, so they can't
suffer the same collapse. Spark extras (`additional_rate_limits`) apply the same
duration rule inline (low-stakes, not the failure mode), not the shared jq.

### Rows carry the reset instant, not a duration

Every dashboard row stores `reset_ts`, the absolute epoch the provider itself
supplies - Claude's `resets_at`, Codex's `reset_at` (falling back to
`reset_after_seconds` read against the cache file's mtime, which is when that
countdown was true), Cosine's `billingPeriodResetsAt`. `remaining_secs(row)` is
the only derivation, and clamping happens at each display edge rather than in the
model. So one fact drives three readings: the countdown (`↻ 4h 42m`), the
width-gated wall clock beside it (`· 21:40`, or `· Tue 09:40` on a different local
day), and "this window already ended".

That last one is a state, not a defect to gate around. A clamped duration
collapses "reset five weeks ago" into "resets imminently", which is why an
elapsed Cosine billing period suppresses the pool row and states
`Cosine  billing period ended <date>` instead. The payload's `canInference`,
`trialExhausted` and `tokenBillingEnabled` flags all read healthy on a dead
subscription, so the elapsed period is the only honest evidence.

The clock is gated on the bar width it would leave, not on a bare width
threshold: the box floors at inner 64, so a ~70-col popup keeps its full bar and
the clock appears from ~105 terminal columns up. `AI_USAGE_NOW` (epoch seconds)
pins the dashboard's now so any of this is assertable.

Codex's usage-limit-reset credits (`rate_limit_reset_credits`) render as a
`Resets` line reporting both what the account holds and what is spendable now
(`applicable_available_count`); nothing is emitted at zero. It goes through the
always-render `standing` list, not `alerts`, which is sliced to three - ranked by
severity, so a red is never dropped for a yellow. Claude's `/api/oauth/usage`
carries no reset-credit field, so this stays Codex-only.

Surfaces:

- [`../zsh/functions/agents/ai-usage`](../zsh/functions/agents/ai-usage)
  (`aiu`, popup via `prefix + a`) renders combined usage. `--cache-only` renders
  the fancy dashboard without contacting providers; `--refresh-only` refreshes
  all providers silently, waiting for both its children and any live provider
  lock (bounded to 20 seconds). Direct `--fancy` retains refresh-then-render
  compatibility.
- [`scripts/ai-usage-popup.sh`](./scripts/ai-usage-popup.sh) renders
  `--cache-only` first, then starts a detached `--refresh-only`. A key dismisses
  within the 100 ms TTY poll interval without cancelling refresh. Natural
  completion redraws once only when a usage cache or metadata file changed;
  cleanup always restores the saved TTY state, cursor, and alternate screen.
- [`../zsh/functions/usage-debug`](../zsh/functions/usage-debug) prints cache,
  backoff, lock, and provider usage details.

Tests: [`../zsh/tests/codex-windows.bats`](../zsh/tests/codex-windows.bats)
(the classifier's combinatorial matrix),
[`../zsh/tests/claude-usage.bats`](../zsh/tests/claude-usage.bats),
[`../zsh/tests/codex-usage.bats`](../zsh/tests/codex-usage.bats),
[`../zsh/tests/cosine-usage.bats`](../zsh/tests/cosine-usage.bats),
[`../zsh/tests/ai-usage.bats`](../zsh/tests/ai-usage.bats),
[`../zsh/tests/ai-usage-popup.bats`](../zsh/tests/ai-usage-popup.bats),
[`../zsh/tests/usage-debug.bats`](../zsh/tests/usage-debug.bats).

## Memory-pressure monitoring (custom subsystem)

macOS-only memory gauge, parallel in shape to the agent dots: one shared lib and
three surfaces speaking one vocabulary - `OK | BUSY | CRITICAL`, encoded as
colour plus glyph plus swap figure or a `▲` pressure-cause marker. Change as a set:

- [`scripts/mem-lib.sh`](./scripts/mem-lib.sh) - **canonical** thresholds
  (`MEM_BUSY_SWAP_MB` / `MEM_CRITICAL_SWAP_MB`), state mapping (`mem_state`),
  the colour/glyph language (`mem_state_colour` / `mem_state_glyph`), and the
  figure-slot cause logic (`mem_cause` / `mem_token` / `MEM_CAUSE_GLYPH`): when
  kernel pressure (not swap) drives a non-OK state the pill shows `▲` instead of
  the swap figure, so amber/red is self-explaining.
  Swap-used is the primary visible signal; macOS pressure level escalates the
  state (it often reads normal while actively swapping) and, when it is the
  driver, names the cause. Sourced, never run.
  On Linux the macOS sysctls are absent → swap 0, pressure 1 → flat `OK`.
- [`scripts/status-right.sh`](./scripts/status-right.sh) - `mem_segment()`, the
  quiet-when-healthy pill (width ≥ 80 only). It gathers pressure and swap once,
  then uses the lib's pure `*_from` derivations. `ram_percentage()` parses one
  `vm_stat` capture directly on macOS and renders **alongside** it by design -
  RAM% is the total-used headline, mem_segment the swap/pressure signal.
  CPU is stale-while-revalidate: a render returns cached data (or `--%`) at
  once, while one lock-guarded, five-second-bounded sampler writes atomically in
  the background. Fresh data appears on the next native status tick; never force
  a refresh from the sampler.
- [`scripts/mem-popup.sh`](./scripts/mem-popup.sh) - `prefix + Alt+m` bounded
  triage (top 5 sampled `phys_footprint` apps + 3 agents). `k` chooses a visible
  app then a process before handing to `pclose --pid`; `a`/`g` open scrollable
  sampled-app/all-agent details. `h` opens a multi-select list of idle/done
  Claude panes, ranked by the largest physical footprint in each pane's process
  tree. One selection hibernates directly; several require confirmation. Every
  selected pane is attempted, and one result line reports hibernated, refused
  and failed counts. `r` refreshes and `q` closes.
- [`../zsh/functions/macos/memwatch`](../zsh/functions/macos/memwatch) - launchd
  notifier (desktop-only, [`darwin-desktop.nix`](../nix/modules/darwin-desktop.nix)).
  Banners on sustained pressure; log `~/.cache/memwatch.log`. Reload after edits:
  `launchctl kickstart -k "gui/$(id -u)/dev.connorads.memwatch"`.

Tests: [`../zsh/tests/mem-lib.bats`](../zsh/tests/mem-lib.bats) (lib vocabulary),
[`../zsh/tests/mem-popup.bats`](../zsh/tests/mem-popup.bats) (bounded summary and
hibernate flow), and the RAM/mem pills in
[`../zsh/tests/status-right.bats`](../zsh/tests/status-right.bats). Keep the
gauge legend in [`help.md`](./help.md) in sync with the lib. The `memwatch`
notifier is not yet unit-tested.

## Resurrect save freshness (custom subsystem)

Same one-lib-many-surfaces shape as the memory gauge, for a different failure:
**detecting when session saving silently stops.** continuum advances its
save-timestamp unconditionally every 5 min, so a save path that stops producing
files ticks on without error - it did exactly that for 3.5 weeks (saves froze at
28 Jun) until a kernel panic found no recent session to restore. The write path
was healthy; the *silence* was the bug. This subsystem makes save-freshness a
visible, alarming state.

Vocabulary: `FRESH | AGING | STALE | NONE`, from the age of the newest save file.

- [`scripts/resurrect-lib.sh`](./scripts/resurrect-lib.sh) - **canonical**
  thresholds (`RESURRECT_AGING_SECS` 10 min / `RESURRECT_STALE_SECS` 15 min,
  env-overridable for tests), the save-dir resolver (`resurrect_dir`, replicating
  the plugin's `helpers.sh` default), newest-save age (`resurrect_newest_age_secs` -
  max mtime over `tmux_resurrect_*.txt` plus the `last` symlink *target*,
  `_resurrect_mtime` dereferencing with `-L` and handling GNU/BSD `stat`), the
  state mapping (`resurrect_state`), and the colour/glyph/token language
  (`resurrect_state_colour` green/yellow/red, `resurrect_state_glyph` ⟳ turning /
  ⚠ wrong, `resurrect_token` age / `stale` / `none`). Sourced, never run.
  Cross-platform (no macOS-only syscalls), so it works on Linux hosts too.
  Caveat: tmux-resurrect only keeps a timestamped file when session state changed
  since the previous save, so `age` is the age of the last *content-changing*
  save - exactly the signal that went stale in the incident.
- [`scripts/status-right.sh`](./scripts/status-right.sh) - `resurrect_segment()`,
  the always-shown pill (width ≥ 80). It gathers newest-save age once, then uses
  the lib's pure `resurrect_state_from` / `resurrect_token_from` derivations.
  Unlike the quiet-when-healthy mem pill, a
  live green `⟳ 2m` is wanted as the running-confidence signal the incident
  lacked; it reddens to yellow/red the moment saving stops. It is the first
  persistent system pill, followed by the darker CPU pill, so its surface1
  (`#45475a`) shade stays distinct.
- [`scripts/resurrect-keepalive.sh`](./scripts/resurrect-keepalive.sh) - the
  **drive** layer (macOS): an independent save driver run every 5 min by a
  launchd agent (`dev.connorads.tmux-resurrect-save`, defined in
  [`darwin-shared.nix`](../nix/modules/darwin-shared.nix), both Macs), so saving
  depends on launchd rather than continuum's status-refresh-injected autosave.
  It runs `save.sh quiet` capturing exit code + stderr to
  `~/.cache/tmux-resurrect-keepalive.log` (the opposite of continuum's
  `>/dev/null 2>&1`), then verifies both freshness (via the lib) and **content**:
  on `STALE`/`NONE`, or a newest save carrying no `pane` lines, it sets the
  `@resurrect_stale` tmux option and nags each attached client by name
  (`display-message -c` - from launchd there is no current client, so an
  untargeted message would no-op), else clears the flag. The pane count is the
  content half of the check because a corrupt save is still a *new* file, so the
  mtime-only pill reads it as healthy; a server always has at least one pane and
  the no-server case exits earlier, so zero pane lines is unambiguous corruption.
  The success log carries `panes=N`, an empty save logs `SAVE EMPTY`. No tmux
  server ⇒ logs `no server, skip` and exits 0. continuum stays enabled as cross-platform
  redundancy (Linux hosts get the detect pill but no keepalive yet - a deferred
  systemd-timer follow-up); the minor double-save on macs is harmless.
  It **requires a UTF-8 locale**, which it forces when the environment carries
  none or a non-UTF-8 one (the plist sets `LANG` too, but the script guard also
  covers a hand-run from a sanitised env). Outside UTF-8 - and with no `$TMUX`,
  which the keepalive strips by design - tmux sanitises the tabs its format
  output delimits fields with to `_`, so `save.sh` reads an empty session name,
  treats every pane as a grouped session, skips it, and writes a state-only save
  with no panes, while the session-ids hook matches no agent panes and records
  nothing (the map itself survives such a save: unconfirmed entries are carried,
  not rewritten - see the restore subsystem above).
  Its plist `PATH` must also carry **`/usr/sbin`**, where macOS keeps `lsof`: the
  session-ids hook needs it for Codex ids and fails open on a missing tool, so
  without it Codex panes save no session id at all. The lib's `/usr/sbin/lsof`
  fallback is the second line of defence for any other narrow-`PATH` caller.

Restore stays manual (`prefix + Ctrl-r`); `@continuum-restore` is deliberately
`off` (see the resurrect agent-session restore subsystem above).

Tests: [`../zsh/tests/resurrect-lib.bats`](../zsh/tests/resurrect-lib.bats)
(state transitions across the age bands via threshold overrides + aged files,
colour/glyph/token, `last`-target deref) and
[`../zsh/tests/resurrect-keepalive.bats`](../zsh/tests/resurrect-keepalive.bats)
(integration: drives a real save against a throwaway default-socket server, the
skip/alarm/clear/error-capture paths, the locale-less environment, and the
pane-less-save alarm). The pill itself is verified manually
(`status-right.sh 200 "$HOME" "" "" ""`, then `touch -t` an aged save and re-run).

## Caffeine (keep-awake, custom subsystem)

macOS-only keep-awake toggle in the same one-lib-many-surfaces shape as the mem
gauge, with **two modes**. `idle` runs `caffeinate -i`, holding *system* sleep
while, by omitting `-d`, letting the displays sleep normally. `lid` additionally
raises the `SleepDisabled` kernel flag. State is a single managed process so an
active keep-awake is never silently left running in a forgotten shell.

### Why lid mode is not an assertion

**`caffeinate` cannot keep this Mac awake with the lid shut, and no flag to it
can.** Measured here: `pmset -g log` recorded `Entering Sleep state due to
'Clamshell Sleep'` while `caffeinate -i -t 14400` held a live
`PreventUserIdleSystemSleep` assertion. Clamshell sleep is a separate kernel path
that never consults power assertions, so the whole family - `-i`, `-s`, `-d` - is
*structurally* unable to stop it. This is what killed an overnight agent run.

The only lever that works is `sudo pmset -a disablesleep 1`, a kernel
`SleepDisabled` flag checked *before* the clamshell path. Its well-known failure
mode is being silently left on forever - the Mac then never sleeps, in a bag or
on a flight, until the battery dies.

That failure is exactly what this subsystem was built to prevent (managed pid,
self-clearing deadline, a pill so a keep-awake is never invisible), which is why
the flag lives in here rather than being typed by hand.

**Scope note: lid mode is the fallback, not the headline answer.** For a
genuinely long unattended run, `atp --host dev` (agent-teleport, already built)
moves the live session to a machine meant to be on - no root, no battery risk, no
heat in a closed shell. Lid mode is for when the work must stay on this machine.

### The two-layer safety model

`disablesleep` has no process to hang a lifetime on, which breaks the subsystem's
core invariant (`pid liveness == state`). It is restored with the same
hooks-plus-backstop shape used twice already here (agent-state hooks +
`agent-sweep.sh`; continuum + `resurrect-keepalive.sh`):

1. **A supervisor owns the flag.** The recorded pid is a wrapper whose trap
   clears the flag on every *ordinary* exit - manual stop, deadline expiry,
   SIGTERM.
2. **A reconciler catches the rest.** SIGKILL, crash, panic and reboot leave no
   trap to run, so `caffeine-reconcile.sh` clears the flag whenever it is set
   with no live lid session, including at login.

**Neither layer alone is sufficient** - this is the part a future reader needs,
because "just use the supervisor" is the obvious simplification and it is wrong.
Layer 1 misses the panic (this machine has had one; it is what exposed the
resurrect staleness bug). Layer 2 alone would leave up to 5 minutes of wrong
state on every normal stop, and would give the pill nothing to report meanwhile.

Two constraints remove failure states by construction rather than by discipline:

- **Lid mode is always timed.** No indefinite variant is offered, at any layer:
  `caffeine_start_lid` returns 2 for a zero/absent/non-numeric duration, and the
  popup's `l` goes straight to the timed picker. An indefinite lid session is the
  exact artefact this subsystem exists to prevent.
- **Lid mode verifies the flag took.** A minority of macOS 26 reports say
  `disablesleep` does not stick. After setting it, `SleepDisabled` is read back;
  if it is not `1` the start aborts, says so plainly, and writes no pidfile - so
  a failed set never produces an ON-LID pill. A pill that lies about keeping the
  Mac awake reproduces the original bug with extra steps.

### Extending a running session

A session that is nearly up and a run that is not finished is the ordinary case,
and before `[+]` the only route to more time was off → `t` → re-pick, which drops
the hold. Three things about the extension are load-bearing:

- **It adds to the remainder, never sets a fresh total.** `caffeine_extend_total`
  is remaining + picked. Setting would silently *shorten* a session with more
  left on it than the amount picked - the opposite of what the key promises.
- **It is a restart, not an edit.** `caffeinate -t` fixes its deadline at exec and
  offers no way to move it, so extending is `caffeine_start*` with a bigger
  number. In lid mode that briefly drops the kernel flag between the outgoing
  supervisor's trap and the new one. Safe by construction: reaching the key means
  a hand on the keyboard and an open lid, so the clamshell path the flag guards
  cannot fire in the gap.
- **A failed lid extension has already stopped what it was extending**, so the
  popup's failure screen says so. The rc-4 text's "nothing was started" is true
  and, on its own, would read as "nothing changed". The battery confirm runs
  *before* anything is stopped, so declining one costs the running session
  nothing.

Indefinite sessions offer no `[+]` - there is no bounded thing to add to - and
`caffeine_extend_total` returns 3 rather than inventing a total. Lid sessions
extend like any other, and each extension is itself timed, so the always-timed
invariant survives any number of them.

**Dependency: a sudoers rule.** `environment.etc."sudoers.d/20-caffeine-pmset"`
in [`../nix/modules/darwin-shared.nix`](../nix/modules/darwin-shared.nix) grants
exactly two argument vectors, no wildcard. `NOPASSWD` is load-bearing rather than
convenience: the trap must run unattended at 04:00 and the reconciler runs from
launchd with no tty, so a Touch ID or password prompt would break the auto-clear
and leave the Mac unable to sleep. It adds a rule, so the desktop's
`security.pam.services.sudo_local` (Touch ID for normal sudo) is unaffected.

**Open fact:** whether `SleepDisabled` survives a reboot is not yet confirmed on
this machine (it needs a real reboot to settle). The design holds either way -
`RunAtLoad` on the reconciler is load-bearing if it persists and belt-and-braces
if it does not. Settle it with: set the flag, reboot,
`pmset -g | grep SleepDisabled`, and replace this paragraph with the answer.

### The pieces

Change as a set:

- [`scripts/caffeine-lib.sh`](./scripts/caffeine-lib.sh) - **canonical** state
  (`caffeine_state` ON / ON-LID / OFF from pidfile-pid liveness plus the mode
  field), the colour/glyph/token language (`caffeine_state_colour` peach `fab387`
  / maroon `eba0ac`, `caffeine_state_glyph` ☼ / ✷ - both single-width, not the
  double-width ☕ emoji that would break the pill, `caffeine_token` ∞ /
  remaining), and the **drive layer** (`caffeine_start [secs]` /
  `caffeine_start_lid secs` / `caffeine_stop` / `caffeine_toggle` /
  `caffeine_clear_sleep_disabled`), plus `caffeine_clock_at epoch` (wall-clock
  `HH:MM`, trying BSD `date -r` then GNU `date -d @`) and `caffeine_extend_total
  add` - the pure arithmetic behind extending a running session. Sourced, never
  run.
  **Pidfile contract**: `${CAFFEINE_PIDFILE:-$HOME/.cache/tmux-caffeinate.pid}`
  holds one line `pid deadline_epoch mode` (`deadline 0` = indefinite, mode
  `idle`|`lid`). **Field 3 is optional and anything not exactly `lid` reads as
  `idle`**, so pre-lid two-field pidfiles keep working with no migration and a
  garbled field can never claim the privileged mode. `caffeinate -t` self-exits at
  the deadline, so ON-timed clears itself once the pid dies; a stale pidfile reads
  as OFF. No `uname` branch: on Linux the pidfile never exists → OFF.
  `caffeine_sleep_disabled` reads the *real* kernel flag and is deliberately kept
  out of `caffeine_state` - the pill renders every tick and must not fork `pmset`.
  The supervisor `wait`s on its `caffeinate` child rather than `exec`ing it (an
  exec would replace the shell and take the trap with it) and kills it from the
  trap, so a stop leaves no stray caffeinate. `caffeine_stop` **waits** for the
  pid to die: without it an outgoing lid trap can fire *after* a new lid session
  raised the flag, silently disarming a session the pill reports as ON-LID.
- [`scripts/caffeine-popup.sh`](./scripts/caffeine-popup.sh) - `prefix + Alt+k`
  key-loop popup (mem-popup shape). OFF: `i` indefinite, `t` timed
  (30m/1h/2h/4h/8h/12h via fzf), `l` lid-closed (straight to the same picker - lid
  mode has no indefinite path to offer), `q` close. ON / ON-LID: `+` (or `=`) add
  time to what is left - an fzf picker whose rows name the resulting *end time*,
  because "will it outlast the run" is the question being asked and "+1 hour"
  does not answer it - `space`/`o` off, `q` close. The `+` row is hidden while
  indefinite. Both running states also render the end time beside the remaining
  figure, which is what makes the extend decision answerable before the picker is
  even opened. The lid row shows the live power source, and on battery a confirm
  names the costs in the user's terms (drained flat, hot in a closed shell with no
  airflow) and points at `atp --host dev`. A **recovery row** renders in any
  non-ON-LID state whenever `caffeine_sleep_disabled` is true, with `c` to clear
  now; the key is checked *before* the per-state dispatch because a stuck flag can
  coexist with any state. Refreshes the client after each toggle so the pill
  updates at once. Only the *start* action is macOS-gated
  (`command -v caffeinate`); Linux explains it is unsupported and waits for a key.
- [`scripts/caffeine-reconcile.sh`](./scripts/caffeine-reconcile.sh) - layer 2,
  mirroring `resurrect-keepalive.sh` in shape and logging posture (capture rc and
  stderr, never `>/dev/null`). Flag set + no live ON-LID session → clear it, log
  it, and `display-message -c` each attached client by name (from launchd there is
  no current client, so an untargeted message no-ops). Flag set + live ON-LID →
  nothing, the normal case. Unreadable `pmset` → nothing, because a detective
  control must not act on no evidence. A failed clear never fails the run.
  Log at `~/.cache/tmux-caffeine-reconcile.log`. Driven by the launchd agent
  `dev.connorads.tmux-caffeine-reconcile` in
  [`../nix/modules/darwin-shared.nix`](../nix/modules/darwin-shared.nix), beside
  `dev.connorads.tmux-resurrect-save`: `StartInterval` 300 **and** `RunAtLoad`.
- [`scripts/status-right.sh`](./scripts/status-right.sh) - `caffeine_segment()`,
  a **self-hiding** bright accent pill (width ≥ 80): OFF prints nothing, ON shows
  peach `☼ ∞` / `☼ 42m`, ON-LID maroon `✷ 4h`. No structural change was needed for
  lid mode - it already passes state to `_colour`/`_glyph`, so the escalated
  colour arrives through the existing path; only the self-hide guard has to test
  for OFF specifically rather than for "not ON". Grouped with the other custom-lib
  pills after `resurrect_segment`.

Tests: [`../zsh/tests/caffeine-lib.bats`](../zsh/tests/caffeine-lib.bats) (pure
lib: state via real pidfiles including the three-field and legacy two-field
forms, mode, remaining/token, colour/glyph, human-age matrix, the
`caffeine_state`-never-forks-pmset guard, `caffeine_sleep_disabled` against a
`pmset` stub, the always-timed refusals, the extend arithmetic with its three
refusals (nothing running / bad addition / indefinite), the cross-platform
wall-clock, and the stop-wait) and
[`../zsh/tests/caffeine-reconcile.bats`](../zsh/tests/caffeine-reconcile.bats)
(the reconciler's branches, driving `sudo`/`pmset` stubs over a flag *file* so
the two failure shapes - refused, and returns 0 without taking - can be provoked
at all).

The privileged drive path (`caffeine_start_lid`'s happy case) needs real sudo and
mutates a machine-wide kernel flag, so it stays a manual smoke test, as
`caffeine_start`/`_stop` already did: start → `pgrep -fl 'caffeinate -i'` +
`pmset -g assertions` shows `PreventUserIdleSystemSleep` held but not display
sleep → stop → process gone. For lid mode additionally assert `pmset -g | grep
SleepDisabled` is `1` while ON-LID and gone after stop, and prove the actual bug
end to end: start a lid session, shut the lid ~10 min, reopen, and check `pmset
-g log | grep -i clamshell` shows **no** new `Clamshell Sleep` entry in that
window. Keep the pill legend in [`help.md`](./help.md) in sync with the lib.

## vox (recording + transcription, custom subsystem)

Local audio capture and on-device transcription, in the same
one-lib-many-surfaces shape as the caffeine toggle. Two detached `ffmpeg`s
capture the mic (avfoundation) and the system's own output (a Core Audio process
tap, via [`voxtap`](../nix/voxtap/main.swift)) to two mono 16 kHz WAVs; `vox
stop` finalises them, transcribes each with the MacWhisper CLI (`mw`) and merges
them into one timestamped `transcript.md`. General-purpose by design - meetings,
monologues, dictation - with no consumer baked in: integration is
`cat "$(vox last)/transcript.md" | claude -p …`.

**System audio needs no setup at all** - no loopback driver, no Multi-Output
Device, no default-output switch, headphones optional. `vox` *refuses to start*
when the tap is unavailable rather than half-capturing a meeting;
`VOX_MIC_ONLY=1` is the named escape hatch. Why a tap, why no fallback, and why
two ffmpegs: [`docs/adr/0003`](../../docs/adr/0003-vox-system-audio-capture.md).

**The store convention is the load-bearing decision.** One directory per
recording under `${VOX_STORE:-~/Recordings/vox}`:

```text
2026-07-28-140312-triver-kickoff/
    mic.wav  sys.wav      you / them (sys silent => it was a monologue)
    mic.json sys.json     per-track mw output, so a re-merge never re-transcribes
    transcript.md         merged, name-fixed - the artefact everything consumes
    vox.log               ffmpeg + mw stderr (mw reports progress there)
```

The directory name **is** the title - no metadata file holding a duplicate that
can drift - so renaming is `mv`, and Finder, hand and the picker are one
operation. Only the timestamp prefix is ever parsed, never the slug. Colons are
hostile in filenames, hence `YYYY-MM-DD-HHMMSS` rather than strict ISO 8601.

**`solo` vs `2-way` is derived, never stored.** `vox_session_kind` reads whether
`sys.json` carries any segments: if the system track transcribed to nothing,
nobody else spoke. Already on disk, free to read, and self-healing after a
re-transcription - which is why there is still no metadata file. Silence is
therefore a *label*, not an error, and that is what removes any need to declare a
mode at start.

Change as a set:

- [`scripts/vox-lib.sh`](./scripts/vox-lib.sh) - **canonical** state
  (`vox_state`: `RECORDING > TRANSCRIBING > EMPTY > READY > IDLE`, in that
  precedence, the same worst-first shape as the agent dots' `rank`) and the
  colour/glyph/token language (`vox_state_colour` subtext0 `a6adc8`, blue
  `89b4fa` for READY, red `f38ba8` for EMPTY, `vox_state_glyph` `~` `≈` `!` `✓`,
  `vox_token` elapsed via the
  shared `human_age`, or the unread/empty count). Every state is derived from a file
  whose staleness cannot lie, so none of them needs a reaper:
  **`${VOX_JOBFILE:-~/.cache/tmux-vox.job}`** holds `pid start_epoch dir` for the
  transcription `vox stop` is spending minutes on - written by `stop` itself, so
  the pill says TRANSCRIBING whether it was typed in a pane or detached by the
  toggle, and a crashed `mw` reads as finished by pid liveness alone.
  **`${VOX_SEENFILE:-~/.cache/tmux-vox.seen}`** is a marker whose *mtime* is the
  last time you looked: READY is "a non-empty `transcript.md` is newer than
  this", which covers any number of finished recordings without tracking one of
  them, and makes touching the marker the only write. Cleared by opening the
  picker and by starting a new capture. `-size +0` in the count is load-bearing:
  a transcript with nothing in it is not something to go and read. It is instead
  counted by **`vox_empty_count`**, that count's mirror (`-size 0c`, same
  no-marker branch), so every finished transcript lands in exactly one of the two
  and the one marker clears both. EMPTY outranks READY: a recording that produced
  nothing is the one that needs you, and it masks an unread good one only until
  the picker is opened. **Statefile contract**:
  `${VOX_STATEFILE:-$HOME/.cache/tmux-vox.state}` holds one line
  `pids start_epoch dir`, where `pids` is comma-separated with the **mic capture
  first** - it is the leader, and the one whose liveness means RECORDING (`read`
  puts the remainder in the last field, so a directory with spaces survives). It
  also owns the two **pure text parsers** the capture path needs -
  `vox_audio_device_index` (over `ffmpeg -list_devices` output) and
  `vox_mean_volume` / `vox_classify_track` (over `volumedetect` output) - so
  device resolution and the monologue/meeting call are testable with fixtures and
  no audio hardware. Sourced, never run.
- [`../zsh/functions/macos/vox`](../zsh/functions/macos/vox) - the dual-mode
  command (`vox` / `--name` / `stop` / `cancel` / `status` / `ls` / `last` /
  `<file>` / `rename` / `compact` / `prune`). Every subcommand prints **bare
  paths to stdout, one per line**, with progress and diagnostics on stderr, so it
  composes without glue. **Exit 0 means the transcript has content**: `stop` and
  `<file>` print the recording's path either way - the audio is intact, so there
  is somewhere to look - but return non-zero, with one line naming what was not
  recognised, how long the audio was and where the log is. `mw` exits 0 whatever
  it heard, so nothing upstream of this check can tell "no speech" from "mw fell
  over", and one message covers both. `prune --empty` selects by *content* instead of age -
  the silent track of a monologue, keeping the one that carries the recording -
  and is the production caller of the lib's loudness parsers. It measures only
  its candidates, at the moment you ask, and refuses a recording whose every
  track is silent: that is a delete-the-recording decision, not a reclaim one.
- [`../nix/voxtap/main.swift`](../nix/voxtap/main.swift) - the system-audio
  helper, built by [`../nix/modules/voxtap.nix`](../nix/modules/voxtap.nix) with
  the system `swiftc` (desktop-only, like `biokc`/`imagepaste`). Streams 48 kHz
  mono float32 to stdout; `--check` answers "is the tap usable" with its exit
  status, which is what lets `vox` refuse to start; `--probe N` measures instead
  of streaming.
- [`../vox/merge.py`](../vox/merge.py) - a real Unix filter: two `mw` JSON files
  in, interleaved `[hh:mm:ss] Name: text` markdown out, no side effects.
  Stdlib-only so the directory stays eligible for the `py-typecheck-vox` pyrefly
  gate. Applies [`../vox/vocabulary.tsv`](../vox/vocabulary.tsv) (`wrong<TAB>right`,
  whole-word and case-insensitive) because `mw transcribe` has no
  `--vocabulary`/`--prompt` flag and no replacement dictionary in its prefs.
- [`scripts/vox-toggle.sh`](./scripts/vox-toggle.sh) - `prefix + Alt+v`, the
  key the subsystem is actually used through: idle starts, recording stops. Two
  orderings are the design. **Capture starts before the title prompt appears**
  and the answer is applied with `vox rename`, so no audio is lost to typing and
  escaping the prompt leaves the recording running (hence the prompt says
  "recording", not "name"). **Stopping detaches**: `vox stop` stays synchronous
  by contract, and a key press has nowhere to put minutes of transcription, so
  the pill carries the wait and a `display-message` plus `ring_bell` reports the
  end. It reports the **exit code**, not merely whether the command ran: a
  transcript with nothing in it says "no speech transcribed" and names the log,
  and the bell rings either way - a recording that produced nothing needs you
  more than one that worked. Pressed while TRANSCRIBING it starts a new capture - transcription is
  per-directory and detached, so the two never contend. **The title prompt is one
  literal question** (`command-prompt -l`, see the findings below) and the script
  owns it: `vox-toggle.sh prompt DIR [CLIENT]` is the single door, so the pill
  menu asks the same wording with the same flags. **The key runs detached**
  (`run-shell -b`, in [`tmux.conf`](./tmux.conf) and on the prompt's own `name`
  callback): a foreground job queues every key pressed while it lives, and the
  job lives for as long as the prompt is open.
- [`scripts/vox-menu.sh`](./scripts/vox-menu.sh) - the menu behind a click on
  the pill (`#[range=user|vox]`, dispatched from the `MouseDown1Status` chain in
  [`tmux.conf`](./tmux.conf) beside `agents` and `mem`). **Its rows match the
  state**: recording offers Stop / Name… / Discard / Recordings, everything else
  offers Recordings alone. A Stop row with nothing to stop is exactly the drift
  the one-lib rule exists to prevent, which is why the menu is a script reading
  `vox_state` rather than a literal in the config. Discard is `vox cancel` and
  the only `confirm-before` row: it throws audio away, while stopping only
  spends time. **Name… delegates to `vox-toggle.sh prompt`** rather than
  re-spelling a `command-prompt` inside four levels of escaping, and passes the
  clicking client through so the question lands where it was asked for; the
  pill-click row is `run-shell -b` because `display-menu` blocks its caller the
  same way `command-prompt` does.
- [`scripts/vox-popup.sh`](./scripts/vox-popup.sh) - `prefix + Alt+Shift+V` fzf
  library over `vox ls`, previewing each transcript and carrying the derived
  `solo`/`2-way` column - or `empty`, for a recording that transcribed to
  nothing, which `solo` would make indistinguishable from a real monologue. The
  preview is three-way for the same reason: a transcript that exists and is empty
  is *finished*, so "No transcript yet" over it reads as pending forever. Enter
  copies it (tmux buffer plus OSC52), `ctrl-y`
  pastes the path into the calling pane, `ctrl-e` edits, `ctrl-r` renames,
  `ctrl-o` reveals in Finder, `ctrl-p` plays (both tracks mixed when there are
  two, via a temp file because `afplay` cannot read a pipe), `ctrl-d` deletes and
  `ctrl-x` reclaims audio, both confirmed and both over the whole `tab`
  selection. Reclaiming shells out to **`vox prune <path>...`** rather than
  deleting audio here - which files count as audio and what survives has one
  owner, and that is why the CLI grew explicit paths. Opening it is what marks
  everything looked-at, so it is the thing that clears the READY pill. Actions
  run **after** fzf exits (`--expect`), not inside `--bind execute()`, so each
  owns the popup's real tty.
- [`scripts/status-right.sh`](./scripts/status-right.sh) - `vox_segment()`, a
  **self-hiding** pill (width ≥ 80) following one capture from start to read:
  IDLE prints nothing, then `~ 12m` recording, `≈ 40s` transcribing, `✓ 2`
  waiting, `! 1` red for a recording that transcribed to nothing. It reads the
  lib, so the EMPTY pill needed no change here.
  Deliberately the *opposite* treatment to caffeine's bright peach
  alarm - muted subtext0 on the surface1 data-pill shade - because it is visible
  during screen shares and should read as ambient chrome. READY is the one
  exception, in the agent dots' unread blue, and it can only appear once the
  capture has stopped. Elapsed uses `human_age`, not mm:ss, which would tick in
  15 s jumps at this `status-interval` and read as broken.

### Findings that are load-bearing, not tidiness

- **`command-prompt` splits `-p` and `-I` on commas**, into a *sequence* of
  prompts with one answer each (`%%`, `%1`, `%2`, …). So any prompt holding
  **text** - a title, a window label, a path - needs **`-l`** (tmux 3.6+), which
  takes both flags literally. Without it the status line shows the truncated
  first half, and Enter opens a second prompt that swallows every keystroke: the
  "tmux is frozen" symptom, from a wording change nobody thought was a flag
  change. The splitting is deliberate in
  [`scripts/claude-branch-menu.sh`](./scripts/claude-branch-menu.sh) and
  [`scripts/codex-branch-menu.sh`](./scripts/codex-branch-menu.sh), which ask for
  several values at once - hence a rule, not a blanket `-l`.
- **A foreground `run-shell` queues the client's keys.** Keys pressed while the
  job is alive are delivered only once it exits (measured on 3.7b), and a job
  that raises a `command-prompt` or `display-menu` from the CLI lives until that
  prompt or menu closes. A binding whose script prompts therefore needs
  `run-shell -b`, unless something genuinely needs the exit status.
- **Stop must be SIGINT, never SIGTERM.** ffmpeg treats TERM as "immediate exit
  requested" and leaves a WAV with **no valid header** - an unreadable recording.
  INT is the clean-shutdown path that rewrites the header with the real length.
- **A background job from a non-interactive shell inherits SIGINT as `SIG_IGN`**
  (POSIX), and a shell cannot then `trap` it. Real ffmpeg calls
  `signal(SIGINT, …)` unconditionally, which overrides the inherited ignore - so
  `vox stop` works - but a `trap … INT` shell *fake* cannot model that and would
  appear to prove the opposite. The ffmpeg stub in
  [`../zsh/tests/vox.bats`](../zsh/tests/vox.bats) is therefore Python.
- **A live tap blocks avfoundation from OPENING an audio input.** Not from
  running one - a capture already in flight survives the tap's creation - but
  `ffmpeg -f avfoundation -i :0` started while a tap exists blocks forever, with
  no error. So `_vox_start` starts the mic capture, waits for `mic.wav` to appear
  (ffmpeg opens outputs only once every input is open, so the file appearing *is*
  "the mic is live"), and only then starts the tap. Reversed, `vox` hangs with
  nothing on disk.
- **One ffmpeg cannot read both sources fairly.** It reads whichever input is
  behind, and the two start in different timestamp epochs, so the other starves:
  measured, the mic delivered **2.0 s of audio over 8 s of wall-clock**.
  Wall-clock stamps on the pipe invert it exactly (mic 7.0 s, system 0.26 s) -
  the same first-pts trap as `-t`. Hence one single-input ffmpeg per source.
- **The tap delivers nothing at all through silence** - 0 bytes over 4 idle
  seconds, not zeros - so `voxtap` pads to a monotonic clock on a 100 ms timer.
  Without it every quiet stretch would vanish and the two tracks would drift
  apart. The padding invariant is regression-tested in `vox-contract.bats`.
- **That padding is digital zeros, and Parakeet blanks on a zero-padded tail.**
  A clip ending in enough of them transcribes to an EMPTY string
  ([NVIDIA-NeMo/Speech#15757](https://github.com/NVIDIA-NeMo/Speech/issues/15757)).
  Measured on one 2.6 s quiet utterance: intact at +5 s of zeros, gone at +12,
  and fine at +12 or +24 s of *real room tone* - so it is the zeros, not the
  length and not the level. A live mic never emits zeros, so `mic.wav` is immune;
  `sys.wav` is speech followed by exactly that shape, so **on a call whose far
  side speaks briefly then goes quiet, their words were silently dropped**.
  `_vox_trim_tail` therefore hands `mw` a trimmed COPY of each track (one
  `silenceremove` with a POSITIVE `stop_periods`, which trims the end alone - a
  negative one strips internal silence and shifts every timestamp `merge.py`
  interleaves on), at the existing `VOX_SILENCE_DB` threshold. The stored WAV is
  the archive and is never modified. Measured: 14.60 s → 4.61 s on the padded
  case, and 15.38 s → 15.38 s on a real mic track that transcribes identically.
  A synthetic fixture cannot reproduce the blanking (clean `say` speech survives
  60 s of zeros), so the regression guard in `vox.bats` measures **what mw was
  handed** instead, with a fake mw that keeps its input.
- **`pan`, not `-ac 1`, on the mic.** A multichannel input would get a surround
  downmix matrix (LFE and height coefficients) instead of the channels apps
  actually write. The tap needs none of it: it is mono at source.
- **No `-t`.** Duration is driven externally by `vox stop`, because `-t`
  misbehaves alongside `-use_wallclock_as_timestamps 1` (the first pts starts at
  device uptime).
- **The mic is resolved by name at start**, never by a recorded index:
  avfoundation renumbers every input when one appears or disappears (connecting
  AirPods is enough). System audio needs no lookup at all.
- **`local path=…` in zsh empties `$PATH`.** zsh ties the `path` array to `PATH`,
  so a scalar local of that name kills external command lookup for the whole
  function. `_vox_rename` uses `rec`/`full` for exactly this reason.
- **`:a`, not `:A`, when echoing a path back.** `:A` resolves symlinks, so the
  printed path jumps to the physical one (`/var` → `/private/var` on macOS) and
  no longer matches the store path the caller passed in.
- **The model is pinned per invocation** (`mw transcribe --model …`), never via
  `mw models select`, which mutates the GUI app's own state.
- **`mw` emits a top-level `"text"` key even when it transcribed nothing.** So
  `vox_session_kind` tests positively for a segment object (`"segments":[{`
  after stripping whitespace, because mw pretty-prints); looking for the word
  `"text"` called every silent system track `2-way`. Hand-written fixtures could
  not catch this, which is why `vox-contract.bats` now drives real `mw` over
  real silence.
- **A quiet room is nowhere near digital silence.** Measured here: a system
  track that captured nothing reads **-91 dB**, a microphone in a quiet room
  **-55 dB**. `VOX_SILENCE_DB` therefore sits at -70, between them - above the
  mic's floor and `prune --empty` finds a monologue's *mic* track silent too,
  and skips the recording as having captured nothing.

### Known skew

The system track starts ~0.3 s after the mic - the gate above, plus the tap's own
setup - and both end together, so the two files differ slightly in length. Larger
skew, or drift over a long call, would show up as an `ffprobe` duration gap that
grows with the recording; the fix would be one aggregate device carrying both the
input device and the tap (see the ADR), not a second clock.

Tests: [`../zsh/tests/vox-lib.bats`](../zsh/tests/vox-lib.bats) (pure lib: the
four states and their precedence via real statefiles and marker mtimes, elapsed,
colour/glyph/token, and both text parsers against captured fixtures),
[`../zsh/tests/vox.bats`](../zsh/tests/vox.bats) (the command:
ls/last/status/rename/cancel/compact/prune, plus the ffmpeg argv and SIGINT stop
via PATH-shadow fakes - both the ffmpeg and voxtap fakes are Python, for the
reasons in the findings above),
[`../zsh/tests/vox-toggle.bats`](../zsh/tests/vox-toggle.bats) (the binding, on a
bare server: start-then-prompt order and the detached stop),
[`../zsh/tests/vox-menu.bats`](../zsh/tests/vox-menu.bats) (the pill menu's rows
per state), [`../zsh/tests/vox-popup.bats`](../zsh/tests/vox-popup.bats) (the
library's actions, driven through a stubbed fzf), [`../zsh/tests/vox-contract.bats`](../zsh/tests/vox-contract.bats)
(integration-tagged: drives the **real** `mw` against the JSON schema `merge.py`
parses - the one contract here that is not ours to keep - and the **real**
`voxtap` against the padding invariant) and
[`../vox/test_merge.py`](../vox/test_merge.py) (the filter). Keep the pill legend
in [`help.md`](./help.md) in sync with the lib.

## fzf-links path schemes (`prefix + u`)

[tmux-fzf-links](https://github.com/alberti42/tmux-fzf-links) scrapes the visible
pane, matches paths and URLs, and opens the chosen row. **Path handling is ours,
not the plugin's**: `rm_default_schemes = ["file", "dir"]` in
[`user_schemes.py`](./user_schemes.py) drops the default file scheme outright and
three schemes replace it - `image` → SYSTEM_OPEN (Preview / xdg-open), `folder` →
`cd` the pane, `path` → EDITOR. The plugin keeps the URL, git, traceback and OSC 8
hyperlink schemes, plus its LS_COLORS colouring and popup plumbing.

Reversal is one line: delete `rm_default_schemes` and `user_schemes` and the
plugin's own behaviour resumes.

Two files, and the split is load-bearing:

- [`fzf_link_paths.py`](./fzf_link_paths.py) - the core, importing nothing from
  the plugin, so it is testable, typecheckable and runnable with no plugin
  checkout. Matching (two regexes), resolution (cwd then repository root),
  `kind_for`, `display_for`, `claim` and `cd_command`.
- [`user_schemes.py`](./user_schemes.py) - the adapter, the only file touching
  the plugin, with no branches. It loads the core by path (`spec_from_file_location`,
  the plugin's own mechanism) rather than putting `~/.config/tmux` on the import
  path, where a name that generic would shadow whatever else is installed.

Findings that are load-bearing, not tidiness:

- **`checked` is dead, so shadowing a tag does nothing.** `__main__.py` creates
  the set, reads it, and deletes it without ever adding to it, so the documented
  "user schemes take precedence" does not work: a user scheme claiming `file`
  runs *alongside* the default file scheme, and `tag_to_index` is last-wins, so
  the **default** scheme owns the tag. `rm_default_schemes` is the mechanism that
  works - and it is checked against user schemes too, so a scheme claiming `file`
  while also removing it removes *itself*. Hence fresh tag names plus removal.
- **Three schemes, not one with three tags.** `opener` is per scheme, so one
  scheme cannot send an image to Preview and a source file to $EDITOR. Each
  pre-handler declines what is not its own kind, so exactly one claims each
  match. The cost is that the content is scanned once per scheme (~0.02s
  typical, 0.34s on 2000 prose-heavy lines).
- **The `path` scheme goes through upstream's EDITOR opener** rather than
  hand-rolling the `%file`/`%line` templating, which is what brings back its
  `isBinaryFile` refusal. The default file scheme templated under CUSTOM_OPEN,
  so that check never ran and a picked `.zip` really did open in nvim.
- **The cwd and repository root are resolved lazily.** The plugin imports the
  user module at `__main__.py:247`, 46 lines *before* it chdirs to
  `#{pane_current_path}` at `:293`, so anything eager answers for the wrong
  directory. `GIT_DIR`/`GIT_WORK_TREE` are stripped from the `rev-parse`
  environment, or the dotfiles hook wrappers would make every pane report this
  repository's root.
- **A load failure is already the loudest thing here.** A user-module import
  error is re-raised as `ImportError` (`__main__.py:93`), which the catch at
  `:540` misses, so it lands as a `logging.error` that `logging.py` renders with
  `-d 0` - a sticky message. Do not add a catch-and-degrade: it would turn the
  loudest failure mode into a silent one. Plugin *drift* is likewise already
  reported by `up`.
- **The plugin is pinned in nix, not by TPM.** `home-shared.nix` pins the SHA and
  `home.activation.tmuxPlugins` converges it, so an upstream change arrives as a
  deliberate commit.
- **Resolution is memoised and claimed.** A scheme's pre-handler and post-handler
  must agree on which file a row means, so `resolve` is cached; and `claim` gives
  each (file, line) one row, because the plugin dedupes on the matched *text* and
  a file written absolutely in one line and relatively in another would otherwise
  be two identical-looking rows.
- **A path with spaces is found by a suffix walk**, dropping *leading* words from
  a run until one exists, longest first - so `git status`' `M  walkies/my
  image.png` resolves. Trailing chrome is not handled (`wrote a/my b.png ok`
  finds nothing): dropping trailing words too would square the probe count and
  invent paths out of prose. A spaceless tail is left to the token regex, or one
  file would get two rows.
- **An apostrophe in a filename is not openable**, and that is upstream's
  quoting, not ours: both SYSTEM_OPEN and EDITOR build a shell string
  (`open '%file'`) and `shlex.split` it, so a `'` raises rather than opening the
  wrong file. Only `cd_command`, which is ours, quotes properly. Fixing it means
  a CUSTOM_OPEN scheme with an explicit argv.

### Too many rows wedges the tmux server

**This is the failure mode to know about, because it looks like tmux has died.**
Measured end to end on a throwaway server, and reproduced with the stock schemes
too - it is upstream's, not ours:

1. `run_fzf` embeds **every row** in the argument of one `tmux popup -E`
   command, as `echo "<all rows>" | fzf …`.
2. tmux refuses any command over `MAX_IMSGSIZE`, printing `command too long`.
   The cliff sits between 16000 and 16400 bytes on 3.7b, so the popup never
   starts and never runs its shell command.
3. `run_fzf` then blocks **forever** in `open(stdout_pipe)` - a FIFO whose only
   writer would have been that command. There is no timeout.
4. The plugin binds its key with a **foreground `run-shell`**, so the client's
   keys and clicks queue behind the job (see "A foreground `run-shell` queues
   the client's keys" above). The terminal appears dead and has to be killed;
   the python is still there afterwards, sleeping in `open`, and shows up under
   `ps -Ao pid,ppid,command | grep tmux_fzf_links` parented by the server.

The row count needed is low, because the plugin's own numbered and coloured
prefix costs **56 bytes per row** (20 uncoloured) before any path text - it, not
the display text, dominates the command. Two things keep us clear of the cliff:

- **`@fzf-links-history-lines 0`** in [`tmux.conf`](./tmux.conf), the plugin's
  own default: the picker offers the visible pane. It was 2000, which on a codex
  pane in a repo turned a 40-line screen into 166 rows and a 21KB command.
- **`ROW_BUDGET`** in [`fzf_link_paths.py`](./fzf_link_paths.py): `claim`
  refuses a row once our rows have spent it. That bounds *our* contribution
  only - the default schemes' rows (urls, hyperlinks) are unbounded and merged
  after ours, so a screen densely packed with long URLs alone can still wedge.
  A refused row is a path on screen with no picker row: silent, and deliberately
  preferred to a tmux you have to kill.

Measured on the pane that wedged (2000 lines of scrollback): stock 185 rows /
21244 B (wedges); ours with the budget 13.6KB; ours at `history-lines 0`
1583 B. `test_fzf_link_schemes.py` pins the arithmetic by rendering rows exactly
as `__main__` does and asserting the command stays under the limit - the guard
fails if the budget or the per-row overhead drifts.

Not fixed here, and worth doing upstream: choices belong in a temp file rather
than a command argument, and the FIFO open needs a timeout so a failed popup
cannot hang. A `run-shell -b` binding would also turn any future hang from a
dead terminal into a no-op.

Gates and tests: `py-typecheck-tmux` (pyrefly strict, the **core only** - the
adapter's `tmux_fzf_links` import resolves only beside the gitignored plugin
checkout) and `py-tests-tmux` (pytest via `uv`, at commit time) in
[`hk.pkl`](../../hk.pkl), plus `mise run py-checks`.
[`test_fzf_link_paths.py`](./test_fzf_link_paths.py) is the core's table tests;
[`test_fzf_link_schemes.py`](./test_fzf_link_schemes.py) drives the **real**
plugin - it merges user and default schemes exactly as `__main__.py` does and
asserts the default file scheme is gone, our three tags are ours, and each kind
of path gets one row - and skips itself when the checkout is absent.
