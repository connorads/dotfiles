# tmux shell glue re-execs itself under bash 5

Every executable bash script under [`.config/tmux/scripts`](../../.config/tmux/scripts),
[`.config/tmux/strategies`](../../.config/tmux/strategies) and
[`.config/tmux/save_command_strategies`](../../.config/tmux/save_command_strategies)
carries an inline preamble that re-execs it under a bash >= 5 found at a known
absolute path. The sourced libs under `scripts/lib/` cannot `exec`, so they assert
the same requirement and fail loudly instead.

The invariant this establishes: **a script behaves identically whichever interpreter
the caller's PATH happens to supply.**

## Context

`#!/usr/bin/env bash` resolves through the caller's `PATH`. In the tmux server's
`PATH`, `/bin` sits at position 82 while the nix profiles carrying bash 5.3.15 sit at
91-93. Apple's `/bin/bash` is 3.2.57, released in 2007: no `mapfile`, no
`declare -A`. So bash 5 was already installed and reachable - it simply lost on
ordering, and the interpreter was ambient and unpinned.

Three failures, all live in production rather than only under test:

- The **plan viewer** (`prefix + T` -> `claude-plan-popup.sh`) died on
  `mapfile: command not found`.
- **Resurrect session-id save** died on `declare: -A: invalid option` whenever the
  save ran *through tmux* - keybinding or continuum autosave. Broken since `3600f84e`
  (2026-06-24), and it survived only because the launchd keepalive happens to get a
  different bash.
- **`_resurrect_squote`** silently produced a *wrong value* under 3.2, corrupting
  OpenCode yolo-mode restore. Verified directly: 3.2 emits `'{"note":"it\'\\'\'s"}'`
  where bash 5 emits `'{"note":"it'\''s"}'`.

The same root cause produced 22 of ~51 `mise run zsh-tests` failures.

Two properties made this hard to see. The failures are *silent*: `resurrect-post-save.sh`
only `log_warn`s a failed step and then `exit 0`s. And they are *conditional on the
caller* - the same script worked by hand and failed under tmux.

## Decision

**Entry points re-exec. Libs assert.** You cannot `exec` a sourced file, and
`lib/resurrect-argv.sh` is sourced by seven different entry points, so the two halves
necessarily differ.

The preamble stays 3.2-parseable and sits **above `set -u`**, because bash < 4.4
treats `"$@"` with zero args as unbound. It tries nix profile paths first, with
`/opt/homebrew/bin/bash` as a final fallback, and sets a sentinel env var to prevent
an exec loop.

Three details are load-bearing rather than tidiness:

- **The guard is unset on the success path.** It must never be inherited.
  `resurrect-post-save.sh` re-execs to bash 5, then `run_step` spawns
  `resurrect-save-sessions.sh` as a **child process** whose own `env bash` still
  resolves to 3.2. An exported guard makes that child skip its own re-exec and die
  under 3.2 - silently, since `run_step` only logs. Both the flaw and the fix were
  verified directly, and a regression test pins it.
- **The `-n guard` branch exits 127** rather than falling through. With the guard
  unset on success, a still-too-old interpreter must fail loudly.
- **No version probe on candidates.** Probing costs an extra bash startup each
  (11 ms vs 6.3 ms total). The candidates are nix paths, 5.x by construction now that
  `bash` is declared in [`packages.nix`](../../.config/nix/modules/packages.nix), and
  the guard branch turns a bad pick into a loud failure rather than a loop.

The preamble goes into **all 27** entry points, not only the ~10 that need bash 5
today. "Every bash entry point carries this exact block" is an exact-match grep, and
is enforced by the `bash5-preamble` hk step. "No bash 4+ feature anywhere" needs a
real parser, and is the rule that rotted last time. Uniformity also means a new
author who copies an existing script is correct by default.

`#!/bin/sh` files are exempt - they are genuinely POSIX-clean - so the gate keys on
**shebang, not the `.sh` extension**. The lib rule keys on the `lib/` directory
instead, because `lib/claude-plan.sh` has no shebang at all.

This is a named, standard idiom - the **"two-stage shebang"** / self-relaunch
pattern. Independent sources converge on the same three implementation details used
here: `exec` (no extra shell left in the process tree), pass `"$0" "$@"` to preserve
arguments, and a sentinel env var to prevent an infinite re-exec loop. The prior art
also notes that explicit re-exec is more robust for scripts run from cron, LaunchAgents
or other minimal-environment contexts - precisely this situation.

Two deliberate divergences from the common advice. Guides usually make the first
stage `#!/bin/sh`; the bash shebang is kept because the preamble is 3.2-parseable
anyway, *some* bash is guaranteed on every host here, and an `sh` first stage would
lose shellcheck's bash dialect across the whole file. And the candidate list is
nix-first rather than Homebrew-first, because bash 5 is nix-declared here.

## Considered Options

- **Port the affected scripts to zsh.** Rejected: it loses shellcheck on the three
  trickiest files, and creates a 3-of-31 language split in a directory that is
  otherwise entirely bash/sh.

- **Write to the bash 3.2 dialect and lint for it.** The commonly recommended answer
  ("just use `case` instead of associative arrays"). Rejected for a reason specific to
  this repo rather than a general disagreement: **nixpkgs has no bash 3.x** - only
  `5.3p15`; `bash_3` / `bash32` do not exist - so the differential test that would
  gate the dialect can only ever run on macOS against Apple's bash. Unenforceable in
  Linux CI, a permanent tax on 27 files, and it rests on Apple continuing to ship a
  2007 shell.

- **Reorder PATH globally so nix precedes `/bin`.** Rejected: it changes which `sed`,
  `grep`, `awk` and `date` every script on the machine gets. The blast radius far
  exceeds the bug.

- **Rewrite `resurrect-save-sessions.sh` in Python.** Rejected as unnecessary: the
  file runs unmodified under bash 5, verified end to end. It also fixes one script
  while leaving the class intact.

- **Scope by source graph** - have the checker compute which entry points
  transitively source a `lib/` file or use bash-4 syntax, giving ~10 files instead of
  27. Rejected: precise, but a bug in that parser is a *silent* gap, which is the
  exact failure class this change exists to remove.

- **Share one sourced `lib/bash5.sh`** - one line per entry point instead of ~20.
  `exec` from a sourced file does correctly replace the caller's process
  (spike-verified), so the mechanism works. Rejected because `setup_test_home`
  deliberately clobbers `$HOME`, so every bats file covering an entry point would
  first have to provision that lib into the fake home, the way
  `tmux-resurrect-sessions.bats` already copies `resurrect-argv.sh`. That trades 27
  inert copies for test-provisioning coupling across many files.

## Consequences

- **Cost: ~4.5 ms per invocation on macOS, zero on Linux** (ambient bash is already
  5.x, so no re-exec fires). `status-interval` is 15 s, so even `status-right.sh`
  pays ~0.03% duty.

- **27 near-identical copies of the preamble.** This is only tolerable because the
  `bash5-preamble` hk step
  ([`.hk-hooks/bash5-preamble.py`](../../.hk-hooks/bash5-preamble.py)) polices it:
  entry points must contain the block, libs must contain the assert, `sh` files must
  contain neither. Deleting a preamble by hand fails the commit. If that gate is ever
  removed, the duplication becomes a liability rather than a policy.

- **The entry-point/lib asymmetry is a rule anyone adding a new lib must know.** It is
  documented in [`.config/tmux/AGENTS.md`](../../.config/tmux/AGENTS.md) and enforced
  by the gate, but it is not self-evident from reading one file.

- **The lib assert is gated on `BASH_VERSION`.** Two shipping zsh functions -
  `agent-teleport` and `claude-session-adopt` - source these libs, and zsh sets no
  `BASH_VERSINFO`, so an ungated assert would refuse to load for them. The gate is
  therefore load-bearing, and the hk step checks for it specifically.

- **A zsh caller that shells out must not use bare `bash`.** `agent-teleport` did, and
  landed on 3.2. It now goes through
  [`scripts/lib-call.sh`](../../.config/tmux/scripts/lib-call.sh), an ordinary
  gate-covered entry point, so the candidate list stays in exactly one place.

- **`status-right.sh` and friends gain a new way to fail** - `exit 127`, visibly
  breaking the status bar - despite using no bash-4 feature. Accepted: that branch is
  only reachable on a machine with no nix bash *and* no Homebrew bash, and tmux itself
  is nix-installed here, so such a machine would never run these scripts at all.

- **`bash` is now declared in `packages.nix`.** The guarantee is stated rather than
  inherited incidentally from the nix-darwin system profile.

- **The test harness mirrors production.** `setup_test_home` now builds `$PATH`
  native-first, which is what lets a macOS-only portability bug fail in CI rather than
  only in production; tests that need bash 5 use the exported `$BASH5`.

### Parked

- **Linux hosts (`rpi5`, dev boxes) are covered as gate coverage only.** The preamble
  no-ops there. Not verified on a live Linux box.
- **`resurrect-claude-launch.sh` / `resurrect-codex-launch.sh`** carry the preamble but
  are not separately exercised end to end. The restore *strategies* are - all four run
  clean from a 3.2 caller.
