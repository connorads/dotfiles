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

At commit time the `tmux-bind-lint` hk step
([`.hk-hooks/tmux-bind-lint.py`](../../.hk-hooks/tmux-bind-lint.py)) statically
parses [`tmux.conf`](./tmux.conf) and blocks a key bound twice in one key-table
(tmux keeps only the last, so the earlier bind is dead) or both members of a
terminal-alias pair (`C-i≡Tab` etc.) in one table. It is the commit-time
complement to the edit-time `tmux-freekeys` advisor: freekeys queries the
running server (so it sees plugin binds) but only ever shows the *surviving*
bind, whereas the lint reads the source and catches the clobber.

## Popups vs floating panes

Detail: [docs/popups-vs-floats.md](./docs/popups-vs-floats.md).

## Agent state dots (custom subsystem)

Detail: [docs/agent-state.md](./docs/agent-state.md).

## Agent hibernate / thaw (custom subsystem)

Detail: [docs/hibernate.md](./docs/hibernate.md).

## Touch organiser (custom subsystem)

Detail: [docs/organiser.md](./docs/organiser.md).

## Resurrect agent-session restore (custom subsystem)

Detail: [docs/resurrect-restore.md](./docs/resurrect-restore.md).

## AI usage tracker (custom subsystem)

Detail: [docs/ai-usage.md](./docs/ai-usage.md).

## Memory-pressure monitoring (custom subsystem)

Detail: [docs/memory.md](./docs/memory.md).

## Resurrect save freshness (custom subsystem)

Detail: [docs/save-freshness.md](./docs/save-freshness.md).

## Caffeine (keep-awake, custom subsystem)

Detail: [docs/caffeine.md](./docs/caffeine.md).

## vox (recording + transcription, custom subsystem)

Detail: [docs/vox.md](./docs/vox.md).

## fzf-links path schemes (`prefix + u`)

Detail: [docs/fzf-links.md](./docs/fzf-links.md).
