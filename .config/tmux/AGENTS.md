# AGENTS.md — tmux config

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

`#!/bin/sh` and `#!/usr/bin/env sh` files are **exempt** — they are genuinely
POSIX-clean. The rule keys on the **shebang, not the `.sh` extension**.

Three details that are load-bearing, not tidiness:

- **`unset TMUX_BASH5_REEXEC` on the success path.** The guard exists only to
  stop an exec loop, and must never be inherited. Otherwise
  [`scripts/resurrect-post-save.sh`](./scripts/resurrect-post-save.sh) re-execs to
  bash 5, then `run_step` spawns
  [`scripts/resurrect-save-sessions.sh`](./scripts/resurrect-save-sessions.sh) as a
  **child process** whose own `env bash` is still 3.2 — the child inherits the
  guard, skips its own re-exec and dies, and `run_step` only `log_warn`s while the
  script `exit 0`s. Silent, which is precisely the 3.5-week failure shape the save
  freshness subsystem below exists to catch. Regression test:
  `post-save hook does not suppress its child's own bash5 re-exec` in
  [`../zsh/tests/tmux-resurrect-post-save.bats`](../zsh/tests/tmux-resurrect-post-save.bats).
- **The `-n guard` branch exits 127** rather than falling through. With the guard
  unset on the success path, a still-too-old interpreter must fail loudly.
- **No version probe on the candidates.** Probing costs an extra bash startup
  each. The candidates are nix paths (5.x by construction — `bash` is declared in
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
exists so you can act the moment an agent needs you — every open popup is a
window in which that is false. Floats (`new-pane`, tmux 3.7+, wrapped by
[`../zsh/functions/tmux/flt`](../zsh/functions/tmux/flt)) are non-modal real
panes: switch away and come back and the tool is still there.

Three blockers force a popup. Nothing else does:

| Blocker | Why |
|---|---|
| Calls `switch-client` / opens a window | A float belongs to a *window*. Switch away mid-selection and the float and its fzf are stranded. |
| Acts on "the pane I came from" | Popups do not change the active pane; **floats become the active pane**, so origin-by-active-pane resolves to the float itself. |
| Must work from any window | Float scope is per-window, so you get one per window, not one summonable scratch. |

The second blocker is mechanically removable: `run-shell` format-expands its
command before running it (`man tmux`, run-shell: *"Before being executed,
shell-command is expanded using the rules specified in the FORMATS section"*),
so a float binding can pass `#{pane_id}` explicitly and the script takes the
origin as an argument — see `prefix + Alt+w` and `wt-window.sh pane <path>
[origin]`. `display-popup` cannot do this reliably, which is why the popup
callers resolve the origin live instead.

Every float goes through `flt`, the single door carrying the tmux#5327 unzoom
guard; presets live there, so bindings never spell out geometry. Floats are
drag-resizable, so per-binding sizes are not worth the divergence — `big` unless
there is a reason.

These bindings must stay popups, with the blocker each hits:

| Binding | Blocker |
|---|---|
| `prefix + S` (and `M-S`) session switch/create | switch-client |
| `prefix + A` agents popup | switch-client |
| `prefix + Alt+Shift+W` worktree picker | focuses / opens windows |
| `prefix + Alt+s` skl loader | injects the pointer into the origin pane |
| `prefix + Alt+v` vox picker | `ctrl-y` pastes the path into the origin pane |
| `prefix + Alt+Shift+I` shotpath remote | pastes the remote path into the origin pane |

`prefix + Alt+g` → `t` (ghfzf triage) stays a popup as a transaction — pick one
thing, act, done — while the `d`/`u` dashboards on the same menu are floats.
The three origin-pane cases above are now unblockable via the `#{pane_id}`
pattern, but each needs its own script change.

**Floats do not survive a resurrect restore as floats.** tmux 3.7 emits a float
in `#{window_layout}` as a trailing `<…>` cell, but `select-layout` rejects that
string (`invalid layout`), and `restore.sh` replays exactly that saved layout.
Verified on a private socket (save a tiled pane + a float, restore, read
`#{pane_floating_flag}`): every pane comes back, with its command and cwd, as an
ordinary tiled pane. Nothing is lost but the floatness and the geometry. This
exposure predates the popup→float migration — it comes with any float binding —
and is a tmux limitation to revisit on 3.8.

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
- [`scripts/agent-state-lib.sh`](./scripts/agent-state-lib.sh) — shared rank,
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
  **`other_sessions_badge`** — the read-only cross-session fallback (worst of
  blocked>done + a count of such agent panes in sessions other than the attached
  one), rendered by
  [`scripts/status-right.sh`](./scripts/status-right.sh)'s
  `agent_elsewhere_segment` as a right-side pill below 80 columns. It preserves
  the ambient signal when the session rail is likely to trim, self-hides when
  nothing is elsewhere, and is disabled by
  `tmux set -g @cross_session_badge off`. Semantically aligned with `prefix + A`:
  it counts exactly the panes that popup would jump to elsewhere. Tested by
  [`../zsh/tests/agent-badge.bats`](../zsh/tests/agent-badge.bats).
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
- [`scripts/agent-pretooluse.sh`](./scripts/agent-pretooluse.sh) — Codex
  `PreToolUse` hook adapter (sibling of `agent-stop.sh`). Codex's question card is
  the `request_user_input` tool, and unlike Claude's `AskUserQuestion` it fires
  **no** `PermissionRequest` — only `PreToolUse`/`PostToolUse` → `working` — so a
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
  so a new adapter needs no test edit — but one that never reaches
  `agent-state.sh` fails the gate.
- [`scripts/agent-sweep.sh`](./scripts/agent-sweep.sh) — phase-5 reconcile net (a
  one-shot on `client-attached` + a per-server daemon polling every `POLL`, 10s).
  Three jobs: (1) clear a stale dot whose agent died without a clean done/clear
  (shell foreground = agent gone); (2) age a `done` dot you are currently viewing
  (`is_viewing`: active pane, active window, `session_attached>0`) to idle — the
  deterministic backstop for the `done` branch's seen-at-birth and the focus
  hooks' `seen`, which they miss when the finish races your focus or you watch one
  agent while another finishes then return by switching windows (no fresh
  select-pane/window-changed). The attached-session gate keeps detached sessions
  unread (nobody looking); (3) **codex title-spinner working detection** — Codex
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
  `working↔idle`, the hooks own `blocked`/`done`, so `blocked` is left alone and
  `agent-state.sh` is untouched. Precedence stays `blocked > done(unseen) >
  working > idle` (the canonical `rank`). Opt out with
  `tmux set -g @codex_title_poll off` (mirrors `@cross_session_badge off`).
- `@agent_dotfmt` (in [`tmux.conf`](./tmux.conf)) — renders the tab dot from the
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

- [`../zsh/tests/agent-state.bats`](../zsh/tests/agent-state.bats) — verb
  behaviour + rollup; also the pure `has_spinner` glyph matrix and
  `codex_working_step` FSM (lie/resume/stop-debounce/momentary-gap/blocked cases).
- [`../zsh/tests/agent-pretooluse.bats`](../zsh/tests/agent-pretooluse.bats) — the
  Codex `PreToolUse` adapter: `request_user_input` → blocked, else working,
  fail-open, and payload passthrough to the journal.
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
  clearing + the viewed-`done` → idle reconcile (attached/inactive/detached
  gates) + the codex title-spinner working detection (spinner → working, the
  two-poll retire to idle, done-left-alone, `@codex_title_poll off`).
- [`../zsh/tests/agent-popup.bats`](../zsh/tests/agent-popup.bats) — list ranking,
  the name column, jump's move + seen ageing, cycle order/wrap/fallback.
- [`../zsh/tests/agent-cli.bats`](../zsh/tests/agent-cli.bats) — the `agent` CLI:
  resolver, enumerator, ls/state/wait against a private server; prompt send
  mechanics + stall/refusal via a PATH tmux stub; name uniqueness.

Keep the dot legend in [`help.md`](./help.md) in sync with `@agent_dotfmt`.

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
`[{seconds, used_percent, reset_after_seconds}]` list (shortest window first),
using the `primary`/`secondary` slot only as a fallback duration when the API
omits `limit_window_seconds`. Both surfaces render that list - `codex-usage`
shells out to `jq -f`, while the fancy dashboard shells out from Python;
`window_label(seconds)` gives canonical `5-hour`/`7-day` (`5h`/`7d`) wording and
adapts to any other duration. Pace/colour maths uses each window's real length.

Why: OpenAI temporarily removed the 5h window (2026-07-12, Plus/Pro/Business) with
no return date, collapsing usage to a single weekly window that arrives in the
`primary_window` slot. Positional classification (primary=5h, secondary=7d)
mislabels that weekly figure as 5h. Duration classification is adaptive: it
renders only the windows that exist and stays correct whether the 5h window is
gone now or returns later, in either slot. Claude stays positional because its
`five_hour`/`seven_day` keys are named and contractually fixed, so they can't
suffer the same collapse. Spark extras (`additional_rate_limits`) apply the same
duration rule inline (low-stakes, not the failure mode), not the shared jq.

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
  quiet-when-healthy pill (width ≥ 80 only). It gathers pressure and swap once,
  then uses the lib's pure `*_from` derivations. `ram_percentage()` parses one
  `vm_stat` capture directly on macOS and renders **alongside** it by design —
  RAM% is the total-used headline, mem_segment the swap/pressure signal.
  CPU is stale-while-revalidate: a render returns cached data (or `--%`) at
  once, while one lock-guarded, five-second-bounded sampler writes atomically in
  the background. Fresh data appears on the next native status tick; never force
  a refresh from the sampler.
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
  the always-shown pill (width ≥ 80). It gathers newest-save age once, then uses
  the lib's pure `resurrect_state_from` / `resurrect_token_from` derivations.
  Unlike the quiet-when-healthy mem pill, a
  live green `⟳ 2m` is wanted as the running-confidence signal the incident
  lacked; it reddens to yellow/red the moment saving stops. It is the first
  persistent system pill, followed by the darker CPU pill, so its surface1
  (`#45475a`) shade stays distinct.
- [`scripts/resurrect-keepalive.sh`](./scripts/resurrect-keepalive.sh) — the
  **drive** layer (macOS): an independent save driver run every 5 min by a
  launchd agent (`dev.connorads.tmux-resurrect-save`, defined in
  [`darwin-shared.nix`](../nix/modules/darwin-shared.nix), both Macs), so saving
  depends on launchd rather than continuum's status-refresh-injected autosave.
  It runs `save.sh quiet` capturing exit code + stderr to
  `~/.cache/tmux-resurrect-keepalive.log` (the opposite of continuum's
  `>/dev/null 2>&1`), then verifies both freshness (via the lib) and **content**:
  on `STALE`/`NONE`, or a newest save carrying no `pane` lines, it sets the
  `@resurrect_stale` tmux option and nags each attached client by name
  (`display-message -c` — from launchd there is no current client, so an
  untargeted message would no-op), else clears the flag. The pane count is the
  content half of the check because a corrupt save is still a *new* file, so the
  mtime-only pill reads it as healthy; a server always has at least one pane and
  the no-server case exits earlier, so zero pane lines is unambiguous corruption.
  The success log carries `panes=N`, an empty save logs `SAVE EMPTY`. No tmux
  server ⇒ logs `no server, skip` and exits 0. continuum stays enabled as cross-platform
  redundancy (Linux hosts get the detect pill but no keepalive yet — a deferred
  systemd-timer follow-up); the minor double-save on macs is harmless.
  It **requires a UTF-8 locale**, which it forces when the environment carries
  none or a non-UTF-8 one (the plist sets `LANG` too, but the script guard also
  covers a hand-run from a sanitised env). Outside UTF-8 — and with no `$TMUX`,
  which the keepalive strips by design — tmux sanitises the tabs its format
  output delimits fields with to `_`, so `save.sh` reads an empty session name,
  treats every pane as a grouped session, skips it, and writes a state-only save
  with no panes, while the session-ids hook matches no agent panes and records
  nothing (the map itself survives such a save: unconfirmed entries are carried,
  not rewritten — see the restore subsystem above).
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
that never consults power assertions, so the whole family — `-i`, `-s`, `-d` — is
*structurally* unable to stop it. This is what killed an overnight agent run.

The only lever that works is `sudo pmset -a disablesleep 1`, a kernel
`SleepDisabled` flag checked *before* the clamshell path. Its well-known failure
mode is being silently left on forever — the Mac then never sleeps, in a bag or
on a flight, until the battery dies.

That failure is exactly what this subsystem was built to prevent (managed pid,
self-clearing deadline, a pill so a keep-awake is never invisible), which is why
the flag lives in here rather than being typed by hand.

**Scope note: lid mode is the fallback, not the headline answer.** For a
genuinely long unattended run, `atp --host dev` (agent-teleport, already built)
moves the live session to a machine meant to be on — no root, no battery risk, no
heat in a closed shell. Lid mode is for when the work must stay on this machine.

### The two-layer safety model

`disablesleep` has no process to hang a lifetime on, which breaks the subsystem's
core invariant (`pid liveness == state`). It is restored with the same
hooks-plus-backstop shape used twice already here (agent-state hooks +
`agent-sweep.sh`; continuum + `resurrect-keepalive.sh`):

1. **A supervisor owns the flag.** The recorded pid is a wrapper whose trap
   clears the flag on every *ordinary* exit — manual stop, deadline expiry,
   SIGTERM.
2. **A reconciler catches the rest.** SIGKILL, crash, panic and reboot leave no
   trap to run, so `caffeine-reconcile.sh` clears the flag whenever it is set
   with no live lid session, including at login.

**Neither layer alone is sufficient** — this is the part a future reader needs,
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
  if it is not `1` the start aborts, says so plainly, and writes no pidfile — so
  a failed set never produces an ON-LID pill. A pill that lies about keeping the
  Mac awake reproduces the original bug with extra steps.

**Dependency: a sudoers rule.** `environment.etc."sudoers.d/20-caffeine-pmset"`
in [`../nix/modules/darwin-shared.nix`](../nix/modules/darwin-shared.nix) grants
exactly two argument vectors, no wildcard. `NOPASSWD` is load-bearing rather than
convenience: the trap must run unattended at 04:00 and the reconciler runs from
launchd with no tty, so a Touch ID or password prompt would break the auto-clear
and leave the Mac unable to sleep. It adds a rule, so the desktop's
`security.pam.services.sudo_local` (Touch ID for normal sudo) is unaffected.

**Open fact:** whether `SleepDisabled` survives a reboot is not yet confirmed on
this machine (it needs a real reboot to settle). The design holds either way —
`RunAtLoad` on the reconciler is load-bearing if it persists and belt-and-braces
if it does not. Settle it with: set the flag, reboot,
`pmset -g | grep SleepDisabled`, and replace this paragraph with the answer.

### The pieces

Change as a set:

- [`scripts/caffeine-lib.sh`](./scripts/caffeine-lib.sh) — **canonical** state
  (`caffeine_state` ON / ON-LID / OFF from pidfile-pid liveness plus the mode
  field), the colour/glyph/token language (`caffeine_state_colour` peach `fab387`
  / maroon `eba0ac`, `caffeine_state_glyph` ☼ / ✷ — both single-width, not the
  double-width ☕ emoji that would break the pill, `caffeine_token` ∞ /
  remaining), and the **drive layer** (`caffeine_start [secs]` /
  `caffeine_start_lid secs` / `caffeine_stop` / `caffeine_toggle` /
  `caffeine_clear_sleep_disabled`). Sourced, never run.
  **Pidfile contract**: `${CAFFEINE_PIDFILE:-$HOME/.cache/tmux-caffeinate.pid}`
  holds one line `pid deadline_epoch mode` (`deadline 0` = indefinite, mode
  `idle`|`lid`). **Field 3 is optional and anything not exactly `lid` reads as
  `idle`**, so pre-lid two-field pidfiles keep working with no migration and a
  garbled field can never claim the privileged mode. `caffeinate -t` self-exits at
  the deadline, so ON-timed clears itself once the pid dies; a stale pidfile reads
  as OFF. No `uname` branch: on Linux the pidfile never exists → OFF.
  `caffeine_sleep_disabled` reads the *real* kernel flag and is deliberately kept
  out of `caffeine_state` — the pill renders every tick and must not fork `pmset`.
  The supervisor `wait`s on its `caffeinate` child rather than `exec`ing it (an
  exec would replace the shell and take the trap with it) and kills it from the
  trap, so a stop leaves no stray caffeinate. `caffeine_stop` **waits** for the
  pid to die: without it an outgoing lid trap can fire *after* a new lid session
  raised the flag, silently disarming a session the pill reports as ON-LID.
- [`scripts/caffeine-popup.sh`](./scripts/caffeine-popup.sh) — `prefix + Alt+k`
  key-loop popup (mem-popup shape). OFF: `i` indefinite, `t` timed
  (30m/1h/2h/4h/8h via fzf), `l` lid-closed (straight to the same picker — lid
  mode has no indefinite path to offer), `q` close. ON / ON-LID: `space`/`o` off,
  `q` close. The lid row shows the live power source, and on battery a confirm
  names the costs in the user's terms (drained flat, hot in a closed shell with no
  airflow) and points at `atp --host dev`. A **recovery row** renders in any
  non-ON-LID state whenever `caffeine_sleep_disabled` is true, with `c` to clear
  now; the key is checked *before* the per-state dispatch because a stuck flag can
  coexist with any state. Refreshes the client after each toggle so the pill
  updates at once. Only the *start* action is macOS-gated
  (`command -v caffeinate`); Linux explains it is unsupported and waits for a key.
- [`scripts/caffeine-reconcile.sh`](./scripts/caffeine-reconcile.sh) — layer 2,
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
- [`scripts/status-right.sh`](./scripts/status-right.sh) — `caffeine_segment()`,
  a **self-hiding** bright accent pill (width ≥ 80): OFF prints nothing, ON shows
  peach `☼ ∞` / `☼ 42m`, ON-LID maroon `✷ 4h`. No structural change was needed for
  lid mode — it already passes state to `_colour`/`_glyph`, so the escalated
  colour arrives through the existing path; only the self-hide guard has to test
  for OFF specifically rather than for "not ON". Grouped with the other custom-lib
  pills after `resurrect_segment`.

Tests: [`../zsh/tests/caffeine-lib.bats`](../zsh/tests/caffeine-lib.bats) (pure
lib: state via real pidfiles including the three-field and legacy two-field
forms, mode, remaining/token, colour/glyph, human-age matrix, the
`caffeine_state`-never-forks-pmset guard, `caffeine_sleep_disabled` against a
`pmset` stub, the always-timed refusals, and the stop-wait) and
[`../zsh/tests/caffeine-reconcile.bats`](../zsh/tests/caffeine-reconcile.bats)
(the reconciler's branches, driving `sudo`/`pmset` stubs over a flag *file* so
the two failure shapes — refused, and returns 0 without taking — can be provoked
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
them into one timestamped `transcript.md`. General-purpose by design — meetings,
monologues, dictation — with no consumer baked in: integration is
`cat "$(vox last)/transcript.md" | claude -p …`.

**System audio needs no setup at all** — no loopback driver, no Multi-Output
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

The directory name **is** the title — no metadata file holding a duplicate that
can drift — so renaming is `mv`, and Finder, hand and the picker are one
operation. Only the timestamp prefix is ever parsed, never the slug. Colons are
hostile in filenames, hence `YYYY-MM-DD-HHMMSS` rather than strict ISO 8601.

**`solo` vs `2-way` is derived, never stored.** `vox_session_kind` reads whether
`sys.json` carries any segments: if the system track transcribed to nothing,
nobody else spoke. Already on disk, free to read, and self-healing after a
re-transcription — which is why there is still no metadata file. Silence is
therefore a *label*, not an error, and that is what removes any need to declare a
mode at start.

Change as a set:

- [`scripts/vox-lib.sh`](./scripts/vox-lib.sh) — **canonical** state
  (`vox_state`: `RECORDING > TRANSCRIBING > READY > IDLE`, in that precedence,
  the same worst-first shape as the agent dots' `rank`) and the
  colour/glyph/token language (`vox_state_colour` subtext0 `a6adc8`, blue
  `89b4fa` for READY, `vox_state_glyph` `~` `≈` `✓`, `vox_token` elapsed via the
  shared `human_age`, or the unread count). Every state is derived from a file
  whose staleness cannot lie, so none of them needs a reaper:
  **`${VOX_JOBFILE:-~/.cache/tmux-vox.job}`** holds `pid start_epoch dir` for the
  transcription `vox stop` is spending minutes on — written by `stop` itself, so
  the pill says TRANSCRIBING whether it was typed in a pane or detached by the
  toggle, and a crashed `mw` reads as finished by pid liveness alone.
  **`${VOX_SEENFILE:-~/.cache/tmux-vox.seen}`** is a marker whose *mtime* is the
  last time you looked: READY is "a non-empty `transcript.md` is newer than
  this", which covers any number of finished recordings without tracking one of
  them, and makes touching the marker the only write. Cleared by opening the
  picker and by starting a new capture. `-size +0` in the count is load-bearing:
  a failed merge still leaves an empty transcript, and that is not something to
  go and read. **Statefile contract**:
  `${VOX_STATEFILE:-$HOME/.cache/tmux-vox.state}` holds one line
  `pids start_epoch dir`, where `pids` is comma-separated with the **mic capture
  first** — it is the leader, and the one whose liveness means RECORDING (`read`
  puts the remainder in the last field, so a directory with spaces survives). It
  also owns the two **pure text parsers** the capture path needs —
  `vox_audio_device_index` (over `ffmpeg -list_devices` output) and
  `vox_mean_volume` / `vox_classify_track` (over `volumedetect` output) — so
  device resolution and the monologue/meeting call are testable with fixtures and
  no audio hardware. Sourced, never run.
- [`../zsh/functions/macos/vox`](../zsh/functions/macos/vox) — the dual-mode
  command (`vox` / `--name` / `stop` / `cancel` / `status` / `ls` / `last` /
  `<file>` / `rename` / `compact` / `prune`). Every subcommand prints **bare
  paths to stdout, one per line**, with progress and diagnostics on stderr, so it
  composes without glue. `prune --empty` selects by *content* instead of age —
  the silent track of a monologue, keeping the one that carries the recording —
  and is the production caller of the lib's loudness parsers. It measures only
  its candidates, at the moment you ask, and refuses a recording whose every
  track is silent: that is a delete-the-recording decision, not a reclaim one.
- [`../nix/voxtap/main.swift`](../nix/voxtap/main.swift) — the system-audio
  helper, built by [`../nix/modules/voxtap.nix`](../nix/modules/voxtap.nix) with
  the system `swiftc` (desktop-only, like `biokc`/`imagepaste`). Streams 48 kHz
  mono float32 to stdout; `--check` answers "is the tap usable" with its exit
  status, which is what lets `vox` refuse to start; `--probe N` measures instead
  of streaming.
- [`../vox/merge.py`](../vox/merge.py) — a real Unix filter: two `mw` JSON files
  in, interleaved `[hh:mm:ss] Name: text` markdown out, no side effects.
  Stdlib-only so the directory stays eligible for the `py-typecheck-vox` pyrefly
  gate. Applies [`../vox/vocabulary.tsv`](../vox/vocabulary.tsv) (`wrong<TAB>right`,
  whole-word and case-insensitive) because `mw transcribe` has no
  `--vocabulary`/`--prompt` flag and no replacement dictionary in its prefs.
- [`scripts/vox-toggle.sh`](./scripts/vox-toggle.sh) — `prefix + Alt+v`, the
  key the subsystem is actually used through: idle starts, recording stops. Two
  orderings are the design. **Capture starts before the title prompt appears**
  and the answer is applied with `vox rename`, so no audio is lost to typing and
  escaping the prompt leaves the recording running (hence the prompt says
  "recording", not "name"). **Stopping detaches**: `vox stop` stays synchronous
  by contract, and a key press has nowhere to put minutes of transcription, so
  the pill carries the wait and a `display-message` plus `ring_bell` reports the
  end. Pressed while TRANSCRIBING it starts a new capture — transcription is
  per-directory and detached, so the two never contend. **The title prompt is one
  literal question** (`command-prompt -l`, see the findings below) and the script
  owns it: `vox-toggle.sh prompt DIR [CLIENT]` is the single door, so the pill
  menu asks the same wording with the same flags. **The key runs detached**
  (`run-shell -b`, in [`tmux.conf`](./tmux.conf) and on the prompt's own `name`
  callback): a foreground job queues every key pressed while it lives, and the
  job lives for as long as the prompt is open.
- [`scripts/vox-menu.sh`](./scripts/vox-menu.sh) — the menu behind a click on
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
- [`scripts/vox-popup.sh`](./scripts/vox-popup.sh) — `prefix + Alt+Shift+V` fzf
  library over `vox ls`, previewing each transcript and carrying the derived
  `solo`/`2-way` column: enter copies it (tmux buffer plus OSC52), `ctrl-y`
  pastes the path into the calling pane, `ctrl-e` edits, `ctrl-r` renames,
  `ctrl-o` reveals in Finder, `ctrl-p` plays (both tracks mixed when there are
  two, via a temp file because `afplay` cannot read a pipe), `ctrl-d` deletes and
  `ctrl-x` reclaims audio, both confirmed and both over the whole `tab`
  selection. Reclaiming shells out to **`vox prune <path>...`** rather than
  deleting audio here — which files count as audio and what survives has one
  owner, and that is why the CLI grew explicit paths. Opening it is what marks
  everything looked-at, so it is the thing that clears the READY pill. Actions
  run **after** fzf exits (`--expect`), not inside `--bind execute()`, so each
  owns the popup's real tty.
- [`scripts/status-right.sh`](./scripts/status-right.sh) — `vox_segment()`, a
  **self-hiding** pill (width ≥ 80) following one capture from start to read:
  IDLE prints nothing, then `~ 12m` recording, `≈ 40s` transcribing, `✓ 2`
  waiting. Deliberately the *opposite* treatment to caffeine's bright peach
  alarm — muted subtext0 on the surface1 data-pill shade — because it is visible
  during screen shares and should read as ambient chrome. READY is the one
  exception, in the agent dots' unread blue, and it can only appear once the
  capture has stopped. Elapsed uses `human_age`, not mm:ss, which would tick in
  15 s jumps at this `status-interval` and read as broken.

### Findings that are load-bearing, not tidiness

- **`command-prompt` splits `-p` and `-I` on commas**, into a *sequence* of
  prompts with one answer each (`%%`, `%1`, `%2`, …). So any prompt holding
  **text** — a title, a window label, a path — needs **`-l`** (tmux 3.6+), which
  takes both flags literally. Without it the status line shows the truncated
  first half, and Enter opens a second prompt that swallows every keystroke: the
  "tmux is frozen" symptom, from a wording change nobody thought was a flag
  change. The splitting is deliberate in
  [`scripts/claude-branch-menu.sh`](./scripts/claude-branch-menu.sh) and
  [`scripts/codex-branch-menu.sh`](./scripts/codex-branch-menu.sh), which ask for
  several values at once — hence a rule, not a blanket `-l`.
- **A foreground `run-shell` queues the client's keys.** Keys pressed while the
  job is alive are delivered only once it exits (measured on 3.7b), and a job
  that raises a `command-prompt` or `display-menu` from the CLI lives until that
  prompt or menu closes. A binding whose script prompts therefore needs
  `run-shell -b`, unless something genuinely needs the exit status.
- **Stop must be SIGINT, never SIGTERM.** ffmpeg treats TERM as "immediate exit
  requested" and leaves a WAV with **no valid header** — an unreadable recording.
  INT is the clean-shutdown path that rewrites the header with the real length.
- **A background job from a non-interactive shell inherits SIGINT as `SIG_IGN`**
  (POSIX), and a shell cannot then `trap` it. Real ffmpeg calls
  `signal(SIGINT, …)` unconditionally, which overrides the inherited ignore — so
  `vox stop` works — but a `trap … INT` shell *fake* cannot model that and would
  appear to prove the opposite. The ffmpeg stub in
  [`../zsh/tests/vox.bats`](../zsh/tests/vox.bats) is therefore Python.
- **A live tap blocks avfoundation from OPENING an audio input.** Not from
  running one — a capture already in flight survives the tap's creation — but
  `ffmpeg -f avfoundation -i :0` started while a tap exists blocks forever, with
  no error. So `_vox_start` starts the mic capture, waits for `mic.wav` to appear
  (ffmpeg opens outputs only once every input is open, so the file appearing *is*
  "the mic is live"), and only then starts the tap. Reversed, `vox` hangs with
  nothing on disk.
- **One ffmpeg cannot read both sources fairly.** It reads whichever input is
  behind, and the two start in different timestamp epochs, so the other starves:
  measured, the mic delivered **2.0 s of audio over 8 s of wall-clock**.
  Wall-clock stamps on the pipe invert it exactly (mic 7.0 s, system 0.26 s) —
  the same first-pts trap as `-t`. Hence one single-input ffmpeg per source.
- **The tap delivers nothing at all through silence** — 0 bytes over 4 idle
  seconds, not zeros — so `voxtap` pads to a monotonic clock on a 100 ms timer.
  Without it every quiet stretch would vanish and the two tracks would drift
  apart. The padding invariant is regression-tested in `vox-contract.bats`.
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

The system track starts ~0.3 s after the mic — the gate above, plus the tap's own
setup — and both end together, so the two files differ slightly in length. Larger
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
parses — the one contract here that is not ours to keep — and the **real**
`voxtap` against the padding invariant) and
[`../vox/test_merge.py`](../vox/test_merge.py) (the filter). Keep the pill legend
in [`help.md`](./help.md) in sync with the lib.
