# Agent state dots (custom subsystem)

Window tabs show a per-window dot for the *worst* agent state across their panes.
The logic is spread across several files - change them as a set:

- [`scripts/agent-state.sh`](../scripts/agent-state.sh) - sets `@agent_state` per
  pane, rolls the worst up to `@win_agent_state`. Verbs:
  `working|blocked|done|unread|idle|seen|clear|name|unname`. `unread` is the manual
  inverse of `seen` (force `done` even on the focused window - mark a read tab blue
  again). `done` is **seen-at-birth**: if the pane is already on screen when it
  finishes (`is_viewing` - the sweep's gate: an unzoomed pane of the active
  window of an attached session) it goes straight to idle; otherwise blue until
  you focus it.
  `name`/`unname` set/drop `@agent_name`, a user-set pane label (grammar
  `[a-z][a-z0-9_-]{0,31}`, unique among live agents - enforced by the `agent`
  CLI). Invariant: `@agent_name ⟹ @agent_state` (`name` refuses a stateless
  pane), so the sweep's state-gated death-clear always covers the name; `clear`
  drops it too. Not journalled (the schema has no name field). Shown on the pane
  border (blue `⟪name⟫`) and as a column in the popup/`agent ls`.
- [`scripts/agent-journal.sh`](../scripts/agent-journal.sh) - sourced by
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
  ([`scripts/claude-plan-popup.sh`](../scripts/claude-plan-popup.sh) via `prefix +
  T` → "Claude: view plan") is a live *reader* of this journal, not only a
  history consumer: its pure core
  ([`scripts/lib/claude-plan.sh`](../scripts/lib/claude-plan.sh)) takes the latest
  `.plan.planFilePath` per pane (the path encodes the account), gates on *live*
  tmux panes (a reused `%N` only ever shows its current occupant's plan), and
  renders the launching pane's plan straight away or falls back to an fzf picker
  across accounts. No process scraping. Tested by
  [`../zsh/tests/claude-plan-popup.bats`](../../zsh/tests/claude-plan-popup.bats).
- [`scripts/agent-state-lib.sh`](../scripts/agent-state-lib.sh) - shared rank,
  pane→window and window→session rollups, bell, and `is_viewing` helpers (also
  used by `agent-sweep.sh`;
  `is_viewing` is the one definition of "you are looking at the pane", shared by
  the `done` branch, the sweep and auto-hibernation's visibility exemption; its
  optional 4th argument is the window's zoom flag, defaulting to "hidden" so a
  3-argument call is the strict active-pane-only rule), the codex title-spinner
  pure core
  (`has_spinner` + `codex_working_step`, the working↔idle FSM the sweep drives),
  **and the canonical state → glyph + colour mapping**
  (`agent_attrs`/`agent_hex`/`agent_char`/`agent_glyph`). **Shape** encodes state as well as colour so it reads on a
  colour clash and for colour-blind use; `working` is peach (not yellow) so it
  clears the same-yellow active-tab text. See [`help.md`](../help.md) for the
  legend. `@session_agent_state` caches each session's `blocked > done >
  working` summary; idle and hibernated render only on window tabs, so a
  session with no rail dot has no agent running. The bottom rail shows that
  glyph beside every session, including each session containing a linked
  agent window. Topology hooks call `agent-sweep.sh sync` to
  rebuild both cached levels after pane/window moves. The lib also hosts
  **`other_sessions_badge`** - the read-only cross-session fallback (worst of
  blocked>done + a count of such agent panes in sessions other than the attached
  one), rendered by
  [`scripts/status-right.sh`](../scripts/status-right.sh)'s
  `agent_elsewhere_segment` as a right-side pill below 80 columns. It preserves
  the ambient signal when the session rail is likely to trim, self-hides when
  nothing is elsewhere, and is disabled by
  `tmux set -g @cross_session_badge off`. Semantically aligned with `prefix + A`:
  it counts exactly the panes that popup would jump to elsewhere. Tested by
  [`../zsh/tests/agent-badge.bats`](../../zsh/tests/agent-badge.bats).
- [`scripts/agent-stop.sh`](../scripts/agent-stop.sh) - Claude `Stop`/`StopFailure`
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
- [`scripts/agent-pretooluse.sh`](../scripts/agent-pretooluse.sh) - Codex
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
- [`scripts/agent-sweep.sh`](../scripts/agent-sweep.sh) - phase-5 reconcile net (a
  one-shot on `client-attached` + a per-server daemon polling every `POLL`, 10s).
  Three jobs: (1) reconcile Claude/Codex presence from the pane shell's kernel
  foreground process group; (2) age a `done` dot that is on screen
  (`is_viewing`: an unzoomed pane of the active window, `session_attached>0`) to
  idle - the deterministic backstop for the `done` branch's seen-at-birth and the
  focus hooks' `seen`, which they miss when the finish races your focus or you
  watch one agent while another finishes then return by switching windows (no
  fresh select-pane/window-changed). tmux draws every pane of the active window
  at once, so a finished sibling ages without being focused and the tab dot
  reports what is still running; a zoom hides the siblings, so a `done` pane
  behind one stays unread. The attached-session gate keeps detached sessions
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
- `@agent_dotfmt` (in [`tmux.conf`](../tmux.conf)) - renders the tab dot from the
  mapping. The popup reads the lib directly (`agent_glyph`); the tabs and the
  menu literals re-encode it and are guarded against drift by `agent-glyphs.bats`.
- Hooks: `~/.claude/settings.json` (and other agents' hooks) call
  `agent-state.sh` on lifecycle events; Claude's `Stop`/`StopFailure` route
  through `agent-stop.sh` (`working` while `background_tasks` holds finite
  in-flight work, `done` once drained), and Codex's `PreToolUse`
  ([`~/.codex/hooks.json`](../../../.codex/hooks.json)) routes through
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
  ([`scripts/context-menu.sh`](../scripts/context-menu.sh)) set a state by hand
  (literals must match the lib - see `agent-glyphs.bats`).
- [`scripts/agent-cli-lib.sh`](../scripts/agent-cli-lib.sh) - functional core
  shared by the `agent` CLI and [`scripts/agent-popup.sh`](../scripts/agent-popup.sh):
  the target resolver (`%N` | `session:win.pane` | exact `@agent_name`) and
  `agent_list_rows`, the **single agent-pane enumerator** (positional TSV:
  session → window → pane; `cycle` consumes it directly). Attention ranking is
  `agent_rank_sort`, a filter applied at the consuming edge (the popup's list,
  `agent ls`) that injects the canonical `rank()` from agent-state-lib.sh.
  `agent_name_taken` (the live-uniqueness check) lives here too, scoped to the
  enumerator's state-carrying view. Sourced, never executed.
- `agent` CLI ([`../zsh/functions/agents/agent`](../../zsh/functions/agents/agent),
  on PATH via `~/.local/bin`) - the scripting front-end so one agent can drive
  others: `ls`/`state`/`wait` (poll `@agent_state`), `prompt` (gated
  buffer-paste + separate Enter + stall verify with one submit retry), `name`/`unname`,
  `pick`, `goto` (the popup's `jump` by target, so a script can focus a pane by
  the same names `prompt` accepts). It never writes `@agent_state` directly - all mutation goes through
  `agent-state.sh`; `prompt` only sends keystrokes and observes the option the
  agent's own hooks set. `ls` reconciles once before reading, so a live direct or
  wrapped Claude/Codex appears before its first lifecycle hook; its text and JSON
  schemas are unchanged.
- Navigation: `prefix + A` popup (fzf pick) and `prefix + Alt+a` cycle-jump
  (`agent-popup.sh cycle blocked,done` - a CSV state priority list, positional
  order within a state, wraps; the fallback-to-done policy is the binding's
  list, not cycle's. The visited pane is aged seen like any jump).

Tests (run `mise run zsh-tests`):

- [`../zsh/tests/agent-state.bats`](../../zsh/tests/agent-state.bats) - verb
  behaviour + rollup; also the pure `has_spinner` glyph matrix and
  `codex_working_step` FSM (lie/resume/stop-debounce/momentary-gap/blocked cases).
- [`../zsh/tests/agent-pretooluse.bats`](../../zsh/tests/agent-pretooluse.bats) - the
  Codex `PreToolUse` adapter: `request_user_input` → blocked, else working,
  fail-open, and payload passthrough to the journal.
- [`../zsh/tests/agent-journal.bats`](../../zsh/tests/agent-journal.bats) - journal
  lines: curated fields, ExitPlanMode plan capture, no tool_input leak,
  disable/no-stdin/no-op-seen cases, Stop payload pass-through, and the
  metadata-only process reconciliation schema.
- [`../zsh/tests/tmux-agent-tabs.bats`](../../zsh/tests/tmux-agent-tabs.bats) -
  asserts the **exact** `@agent_dotfmt` glyph/colour output against the real
  tmux.conf; update it when you change the state → glyph mapping.
- [`../zsh/tests/agent-glyphs.bats`](../../zsh/tests/agent-glyphs.bats) - derives
  expectations from `agent-state-lib.sh` and asserts all four renderers (tabs,
  prefix+Alt+. menu, right-click pane menu, popup) match it; the drift guard
  for the mapping.
- [`../zsh/tests/agent-sweep.bats`](../../zsh/tests/agent-sweep.bats) - stale-dot
  clearing + the viewed-`done` → idle reconcile (attached/inactive/detached
  gates) + the codex title-spinner working detection (spinner → working, the
  two-poll retire to idle, done-left-alone, `@codex_title_poll off`).
- [`../zsh/tests/agent-popup.bats`](../../zsh/tests/agent-popup.bats) - list ranking,
  the name column, jump's move + seen ageing, cycle order/wrap/fallback.
- [`../zsh/tests/agent-cli.bats`](../../zsh/tests/agent-cli.bats) - the `agent` CLI:
  resolver, enumerator, ls/state/wait against a private server; prompt send
  mechanics + stall/refusal via a PATH tmux stub; name uniqueness.

Keep the dot legend in [`help.md`](../help.md) in sync with `@agent_dotfmt`.

## Coordinator key (`coord`)

One key reaches a dispatcher agent and comes back:
[`../zsh/functions/agents/coord`](../../zsh/functions/agents/coord) (dual-mode,
`prefix + Alt+d`) launches the coordinator in a window named `coord` when none
exists, jumps to it when one does, and from inside it returns to the pane the
key was pressed in. The coordinator itself drives the fleet through the `agent`
CLI above; `coord` only calls `agent name` and `agent goto`, so it never writes
`@agent_state`.

- **All branching is `coord_next_action`** in
  [`scripts/agent-cli-lib.sh`](../scripts/agent-cli-lib.sh): `launch` |
  `goto` | `return` | `return-lost`, from (current pane, coord pane, origin
  alive). The shell gathers, decides once, and performs one tmux effect.
- **The origin is a pane option on the coord pane**, `@coord_return`. tmux has
  no client-scoped options, so this is the nearest lifetime: it dies with the
  pane it serves. Two clients pressing the key share one origin (single-user
  compromise). Liveness is `display-message -p -t <origin> '#{pane_id}'`, the
  same probe `agent wait` uses; a dead origin leaves you in coord with a
  status-line message.
- **Identity resolves `@agent_name` first, then the first window named
  `$COORD_WINDOW`.** A resurrect restore keeps the window name (upstream
  `restore_window_properties`) and the Codex flags (`resurrect-argv.sh`), but
  not the agent name, so a goto found by window re-applies it. At launch the
  name is applied by a detached `agent wait && agent name`, because the
  mutator refuses a stateless pane and a foreground child would hold
  `run-shell`'s pipe, and the key press with it. **For Codex that name lasts
  until the first prompt**: Codex creates its thread lazily on the first
  submit, `SessionStart` fires then, and
  [`scripts/agent-codex-session.sh`](../scripts/agent-codex-session.sh) resets
  the pane (`clear`, which drops the name) in the same second as
  `UserPromptSubmit` sets `working` - 282 such pairs in one month of journal.
  So after the coordinator's first turn it is findable by window only, and
  the next key press re-names it. Anything addressing `coord` by agent name
  across that boundary gets exit 3; address it by pane id, or press the key.
- **Launch spec** is `~/.config/coord/config`, a `KEY=value` file sourced by
  the function (`COORD_KIND` codex|claude, `COORD_MODEL`, `COORD_DIR`,
  `COORD_WINDOW`, `COORD_FLAGS`); an exported `COORD_*` wins, an empty one
  included. Codex takes `-c 'projects."<dir>".trust_level="trusted"'` on argv so
  the first launch meets no trust prompt and resurrect keeps it (`[projects]`
  trust in `config.toml` is machine-local, stripped on commit). Claude takes
  the shared `claude-launch-flags` baseline; posture is `COORD_FLAGS` for both.
  `-c` on a missing directory succeeds silently in tmux, so the function checks
  `COORD_DIR` itself (exit 2).

Tests: [`../zsh/tests/coord.bats`](../../zsh/tests/coord.bats) - the verdict
table, and launch/goto/return/return-lost, the restored-window rename, the
argv per kind and the env override against a private server with stub agents.
