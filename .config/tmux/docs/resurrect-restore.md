# Resurrect agent-session restore (custom subsystem)

tmux-resurrect restores Claude/Codex/OpenCode panes via the custom strategies in
[`strategies/`](../strategies/) (synced into the plugin dir by a `run-shell cp`
in [`tmux.conf`](../tmux.conf)). Session IDs come from `session_ids.json`, keyed
by pane (`session:window.pane`), written by the post-save hook
[`scripts/resurrect-save-sessions.sh`](../scripts/resurrect-save-sessions.sh).
The hook target is [`scripts/resurrect-post-save.sh`](../scripts/resurrect-post-save.sh):
it always attempts both Nix-path stripping and session-map saving, and logs
non-fatal companion failures to `~/.cache/tmux-resurrect-post-save.log`.

**Identity is resolved inside the restored pane, not at eval time (Claude/Codex).**
The strategy emits a *launcher* invocation
([`scripts/resurrect-claude-launch.sh`](../scripts/resurrect-claude-launch.sh),
[`scripts/resurrect-codex-launch.sh`](../scripts/resurrect-codex-launch.sh),
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
`--last`, never a guessed resume. Because resolution is exact, no save-time
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

**The process holds more than one rollout open, so the exact answer comes from
Codex, not from `lsof` order.** A spawned subagent or feature thread (a
`guardian_review`, say) writes its own rollout under the same PID, and that
file stays open after the child finishes; after `/new` the old thread's rollout
stays open too. `lsof` lists by fd, and a later `open()` reuses a freed lower
fd, so the first file listed names the wrong thread for the rest of any such
session - and a fork of that id (`prefix + Alt+b`) opens the child's thread,
not the pane's. `codex_open_rollouts_for_pid <pid>` is that list, nothing more;
`codex_session_file_for_pid <pid> [pane]` picks from it in two tiers:

1. **Exact.** Codex's own `SessionStart` hook
   ([`scripts/agent-codex-session.sh`](../scripts/agent-codex-session.sh), wired
   in [`~/.codex/hooks.json`](../../../.codex/hooks.json)) publishes the thread's
   rollout to the pane as `@codex_rollout_path`. Codex documents the event as
   thread-scoped for the parent thread only - subagents get `SubagentStart` -
   and re-fires it with `source` `resume`, `clear` and `compact`, so the option
   names the thread the TUI is on. `SessionEnd` does not fire on `/new` (only
   on archive, delete, normal exit, or 30 idle minutes with no client), so the
   two events cannot race over the option. It is trusted only while the live
   process still holds that file open - compared by inode, since the hook
   publishes the path Codex handed it and `lsof` prints the kernel's - so a
   value left by an earlier Codex in the same pane can never name a dead
   thread. The hook itself refuses to publish a transcript whose
   `session_meta` is not a user thread, in case that contract moves.
2. **Heuristic.** With no usable pane option (no pane, a launch that predates
   the hook, untrusted hooks, a foreign `CODEX_HOME`), pick the first open
   rollout that `codex_rollout_is_user_thread` accepts: `thread_source` is
   `user`, or absent on rollouts older than the field. Codex's `ThreadSource`
   is `user | subagent | memory_consolidation | <feature label>`, and only the
   first is a thread the TUI can be on. The first listed is the last resort
   when none can be read. This tier cannot tell two user threads apart.

Every consumer with a pane - the branch menu, resurrect saves, hibernate, thaw
and `agent-teleport --pane` - passes it through, so all of them share the exact
tier. The teleport picker enumerates every Codex process on the machine and has
no pane, so it lives on the heuristic tier by construction.

**Every pane running an agent is saved with a command.** The `foreground`
save-command strategy
([`save_command_strategies/foreground.sh`](../save_command_strategies/foreground.sh),
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
[`scripts/lib/resurrect-argv.sh`](../scripts/lib/resurrect-argv.sh): unknown
tokens kept verbatim and in order, stale resume/continue state stripped
(idempotent across repeated restores), argv0 mismatch → bare saved command.

Claude multi-account caveat: a client pane runs under
`CLAUDE_CONFIG_DIR=~/.claude-profiles/code/<name>` (set by `ccp`), invisible in
argv, so the save hook records that one var per pane (`claudeConfigDir`). It reads
it from the live claude PID's real environment via the shared
`claude_config_dir_for_pid` in
[`scripts/lib/agent-session.sh`](../scripts/lib/agent-session.sh) (`/proc` environ
on Linux, `ps -E` token scan on macOS - env introspection is authoritative and
never stale). The launcher `export`s it before `exec` (a real env var, so
spaces/quotes need no shell quoting). Without it a restored client pane reverts to
the personal `~/.claude` account - a cross-billing risk. Only `CLAUDE_CONFIG_DIR`
is persisted; never any other env var - both sources expose the process's full
environment, secrets included.

Account-awareness is not only a restore concern. The **branch/fork** path
(`prefix + Alt+b`, [`scripts/claude-branch-menu.sh`](../scripts/claude-branch-menu.sh))
and the **resurrect save** hook both resolve the pane's account through the same
`claude_config_dir_for_pid`, matching the restore path. A profile pane's live
session lives under `<config_dir>/sessions/<pid>.json` and
`<config_dir>/projects/`, so the resolver
([`scripts/claude-session-resolve.py`](../scripts/claude-session-resolve.py)) takes
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
[`scripts/lib/claude-account.sh`](../scripts/lib/claude-account.sh)
(`claude_account_slug` mirrors `project_slug` in `claude-session-resolve.py`).
The copied base transcript lingers harmlessly as a branch-point session under
the target account.

The fork also **mirrors the source pane's launch flags** (append, model, perm
mode), read from its live argv (`ps -o args=`) through the same
`resurrect_argv_claude_flags` the restore path uses - so a fork of a non-yolo `c`
pane stays non-yolo, and a `cy`/`ccp` source carries its system-prompt append.
The lib strips the source's own stale `-r`/`--fork-session`/`--continue`, so a
fork-of-fork is clean; a source with no override (bare `claude --resume <id>`)
forks bare. The origin launchers themselves - the `c`/`cy`/`cspy` aliases, the
`cyc` function and `ccp` - do not re-type the flag set: it lives once in the shared
[`claude-launch-flags`](../../zsh/functions/claude-launch-flags) owner, which they
word-split.

[`scripts/codex-branch-menu.sh`](../scripts/codex-branch-menu.sh) does the same
through `resurrect_argv_codex_flags`, so a plain `cx` source forks sandboxed and
only a `cxy` source carries `--dangerously-bypass-approvals-and-sandbox`.

With the config dir restored, the launcher then re-materialises the profile's
shared user config (settings + `CLAUDE.md` memory) via
[`claude-profile-materialise`](../../zsh/functions/claude-profile-materialise) - the
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

## Handoff carries posture, it never chooses it

The **invariant across every new pane** - fork, restore, and handoff - is that a
new pane has no more authority than the one it came from, and never silently
less. The handoff rows (`Handoff → Claude` / `Handoff → Codex`) are bound by it
too.

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
  [`~/src/handoff/README.md`](../../../src/handoff/README.md).
- **Only the posture boolean crosses agents.** The menus translate
  `--dangerously-skip-permissions` ↔ `--dangerously-bypass-approvals-and-sandbox`
  and forward nothing else: `--model` and `-c key=val` are meaningless in the
  other CLI. Claude's interactive baseline (the system-prompt append) is added by
  the [`handoff`](../../zsh/functions/agents/handoff) wrapper from the same
  `claude-launch-flags` owner, not re-typed by the menu.

Not durable across a *second* hop: `formats/claude.py` writes
`"permissionMode": "default"` on user lines and the Codex writer emits no
`turn_context`, so a handed-off session's *stored* posture is still wrong. Fixing
that is a writer change with a byte-parity cost.

Tests: [`../zsh/tests/tmux-resurrect-sessions.bats`](../../zsh/tests/tmux-resurrect-sessions.bats).
