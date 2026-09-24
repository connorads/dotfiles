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

Three details that break things if dropped:

- **`unset TMUX_BASH5_REEXEC` on the success path.** The guard exists only to
  stop an exec loop, and must never be inherited. Otherwise
  [`scripts/resurrect-post-save.sh`](./scripts/resurrect-post-save.sh) re-execs to
  bash 5, then `run_step` spawns
  [`scripts/resurrect-save-sessions.sh`](./scripts/resurrect-save-sessions.sh) as a
  **child process** whose own `env bash` is still 3.2 - the child inherits the
  guard, skips its own re-exec and dies, and `run_step` only `log_warn`s while the
  script `exit 0`s. Silent, which is precisely the 3.5-week failure shape the [save
  freshness subsystem](./docs/save-freshness.md) exists to catch. Regression test:
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

At commit time the `tmux-bind-lint` hk step blocks a key bound twice in one
key-table and both halves of a terminal-alias pair; see
[.hk-hooks/AGENTS.md](../../.hk-hooks/AGENTS.md).

## tmux gotchas

These apply to every binding and script, not one subsystem. Measurements and
repros: [docs/vox.md](./docs/vox.md#findings-that-break-things-if-ignored).

- **Text prompts need `command-prompt -l`.** Without it tmux splits `-p` and
  `-I` on commas into a sequence of prompts, and the second one swallows every
  key: tmux looks frozen. The branch menus split on purpose to ask for several
  values at once.
- **A binding whose script prompts or opens a menu needs `run-shell -b`.** A
  foreground `run-shell` queues the client's keys until the job exits, and the
  job lives as long as its prompt. Under `-b` a non-zero exit prints
  `'<cmd>' returned N` over the script's own message, so the script reports with
  `display-message` and exits 0 on every path.
- **Never splice a prompt answer into a shell command.** `%%` goes through tmux
  parsing and then `sh -c`, so a backtick in the answer runs. Store it with
  `set-option -g @name "x%%%"`, which only tmux parses, then read the option
  back and unset it.

## Popups vs floating panes

**A popup is a transaction; a float is a place you dwell. Default to a float.**

- Open every float through [`flt`](../zsh/functions/tmux/flt). It carries the
  unzoom guard and the size presets, so bindings never spell out geometry.
- Use a popup only when a float cannot work: the binding calls
  `switch-client` or opens a window, acts on the pane it came from, or must
  work from any window. A popup is modal, so it hides every agent that needs
  you while it is open.
- [`unflt`](../zsh/functions/tmux/unflt) (`prefix + *`) joins a float back to a
  tiled pane. tmux 3.7 cannot turn a tiled pane into a float, and a resurrect
  restore brings floats back tiled.

Detail: [docs/popups-vs-floats.md](./docs/popups-vs-floats.md).

## Agent state dots (custom subsystem)

- Every write to `@agent_state` goes through `agent_set_state` /
  `agent_clear_state` in
  [`scripts/agent-state-lib.sh`](./scripts/agent-state-lib.sh), called by
  [`scripts/agent-state.sh`](./scripts/agent-state.sh) or the sweep. Hooks,
  menus, hibernate and the `agent` CLI call `agent-state.sh`; nothing sets the
  option directly.
- The [`agent`](../zsh/functions/agents/agent) CLI already lists, waits on,
  prompts, names and jumps to agent panes. Use it; do not re-implement pane
  enumeration. `agent_list_rows` in
  [`scripts/agent-cli-lib.sh`](./scripts/agent-cli-lib.sh) is the one
  enumerator.
- The state -> glyph + colour mapping lives in `agent-state-lib.sh`. A change
  to it also updates the legend in [`help.md`](./help.md),
  `tmux-agent-tabs.bats` and `agent-glyphs.bats`.
- Codex working detection reads the pane title spinner, the app's own OSC
  status. Never scrape the screen body.

Detail: [docs/agent-state.md](./docs/agent-state.md).

## Agent hibernate / thaw (custom subsystem)

- No resolvable session id means no hibernation. `--continue` would resume
  whichever conversation last touched the directory.
- `blocked`, `working` and an empty state need `--force`; a refusal exits 6.
- The tracked automatic mode is `observe`. The sweep policy and memwatch's
  emergency tier share the mode, the pins and `tick.lock`. Controls:
  `agent auto off|observe|on`, `agent pin|unpin`.
- Why lifecycle adapters:
  [ADR 0009](../../docs/adr/0009-hibernate-agent-panes-through-lifecycle-adapters.md).

Detail: [docs/hibernate.md](./docs/hibernate.md).

## Touch organiser (custom subsystem)

- [`scripts/organiser.sh`](./scripts/organiser.sh) addresses sessions, windows,
  panes and clients by stable tmux ids (`$N`, `@N`, `%N`). Names are escaped
  and used only as menu labels.
- Confirm any move, unlink, join or kill that closes the source session or
  acts on every linked copy of a window.

Detail: [docs/organiser.md](./docs/organiser.md).

## Resurrect agent-session restore (custom subsystem)

Already built; extend it, do not re-implement it.

- The launcher resolves the session from `$TMUX_PANE` inside the restored
  pane, never at strategy eval time. An eval-time read sees the global active
  pane and collapses several panes onto one conversation.
- `session_ids.json` is merged, not rewritten. An entry a save cannot confirm
  is carried while its pane still holds a live agent in the recorded dir.
- Only `CLAUDE_CONFIG_DIR` is persisted from an agent's environment. The
  sources expose the full environment, secrets included.
- A restored, forked or handed-off pane keeps its source's launch flags, via
  [`scripts/lib/resurrect-argv.sh`](./scripts/lib/resurrect-argv.sh). It never
  gains or loses authority.

Detail: [docs/resurrect-restore.md](./docs/resurrect-restore.md).

## AI usage tracker (custom subsystem)

- Classify Codex windows by `limit_window_seconds` through
  [`codex-windows.jq`](../zsh/functions/codex-windows.jq), never by JSON slot.
  No surface names a window a duration the payload does not give.
- Rows carry the absolute reset epoch (`reset_ts`). Clamp only at the display
  edge.
- Never print bearer or access tokens in diagnostics.

Detail: [docs/ai-usage.md](./docs/ai-usage.md).

## Memory-pressure monitoring (custom subsystem)

- Thresholds live only in [`scripts/mem-lib.sh`](./scripts/mem-lib.sh). Every
  surface derives state through it.
- State comes from the compressor's two ceilings, slots and segments. Swap is
  a figure, not an input, and kernel pressure 2 adds only the `▲` marker.
- Dry-run memwatch's emergency tier with
  `MEM_CRITICAL_SLOTS_PCT=1 memwatch --once`; in `observe` it logs
  `would hibernate` and touches no pane.

Detail: [docs/memory.md](./docs/memory.md).

## Resurrect save freshness (custom subsystem)

- Thresholds and state live only in
  [`scripts/resurrect-lib.sh`](./scripts/resurrect-lib.sh).
- The keepalive's launchd plist needs a UTF-8 `LANG` and `/usr/sbin` on
  `PATH`. Without UTF-8 tmux mangles its tab delimiters and saves no panes;
  without `/usr/sbin` there is no `lsof` and no Codex session ids.
- Restore stays manual (`prefix + Ctrl-r`); `@continuum-restore` is `off`.

Detail: [docs/save-freshness.md](./docs/save-freshness.md).

## Caffeine (keep-awake, custom subsystem)

- Lid mode is always timed. No layer offers an indefinite lid session.
- `caffeine_state` never forks `pmset`: the pill renders every tick.
  `caffeine_sleep_disabled` is the one reader of the real kernel flag.
- The `SleepDisabled` flag has two owners: the supervisor's trap on every
  ordinary exit, and `caffeine-reconcile.sh` for crash, panic and reboot.
  Neither is enough alone.

Detail: [docs/caffeine.md](./docs/caffeine.md).

## vox (recording + transcription, custom subsystem)

- Every `vox` subcommand prints bare paths on stdout and diagnostics on
  stderr. Exit 0 means the transcript has content.
- The recording's directory name is its title. Only the timestamp prefix is
  parsed, and `solo` / `2-way` is derived from `sys.json`, never stored.
- Pin the model per invocation (`mw transcribe --model`), never with
  `mw models select`, which changes the GUI app's state.

Detail: [docs/vox.md](./docs/vox.md).

## fzf-links path schemes (`prefix + u`)

- Keep `@fzf-links-history-lines 0` in [`tmux.conf`](./tmux.conf) and
  `ROW_BUDGET` in [`fzf_link_paths.py`](./fzf_link_paths.py). A picker
  command over about 16KB makes the plugin block forever behind a foreground
  `run-shell`, and the terminal looks dead.
- Path handling is ours: `rm_default_schemes` in
  [`user_schemes.py`](./user_schemes.py) drops the plugin's file scheme.
  `fzf_link_paths.py` imports nothing from the plugin.
- Do not catch and degrade a user-module load failure. The plugin already
  shows it as a sticky error.

Detail: [docs/fzf-links.md](./docs/fzf-links.md).
