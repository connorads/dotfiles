---
name: dispatching-agent-panes
description: >-
  Triages and splits a batch of tasks into dependency-aware assignments, then
  launches verified, named Claude Code or Codex sessions in tmux. Use when the
  user asks to split, fan out, delegate, parallelise, or spin off a load of
  work into separate coding-agent panes or windows. Not for controlling
  already-running agents, producing only a durable backlog, or unattended
  sequential task execution.
---

# Dispatching Agent Panes

> A pane is not dispatched until its task is isolated, its prompt is submitted,
> and the agent reports that work started.

This skill owns triage, grouping, an approval manifest, and verified launch.
Use `task-plan` when the wanted output is only a durable backlog,
`coding-agents` to control sessions after launch, `tmux` for a blocked modal
prompt, and `task-loop` for unattended sequential execution.

## Build the manifest

1. Read the task source and the working repository. Resolve facts from those
   sources instead of asking the user.
2. Mark each task `accepted`, `deferred`, `rejected`, or `unresolved`. Launch
   unresolved work only in `plan` mode.
3. Group tasks that share one outcome, files, or load-bearing invariants.
   Separate groups that can progress independently. Put dependent groups in
   later waves.
4. Choose one provider default for the run and apply explicit per-assignment
   overrides. Never infer that "agent" means Claude or Codex when the choice
   affects the run.
5. Give each assignment one prompt containing its source, task references,
   outcome, evidence, boundaries, requested skills, deliverable, and
   verification. A planning prompt explicitly forbids edits. An implementation
   prompt tells the agent to read repository instructions before acting.

For the manifest fields and lifecycle, read
[references/manifest.md](references/manifest.md). Store the approved manifest
under `${TMPDIR:-/tmp}/dispatching-agent-panes/<run-id>.json`, never in the
repository.

## Get approval

Show a compact launch table before creating anything. Include task group,
provider, mode, dependencies, base branch and full SHA, worktree policy, window
name, agent name, and shared prompt additions.

Ask through the runtime's structured-question tool. Offer approve, revise, and
cancel. Approval covers only the displayed ready wave. Never launch a later
wave from the earlier approval.

Default to at most six concurrent agents. Use the current tmux session and keep
the user's focused window unchanged. Outside tmux, let the launcher create a
`dispatch-<run-id>` session.

## Isolate editing work

Plan-only assignments may share the current checkout. Every concurrent
implementation assignment uses its own `wt-add` worktree and branch from the
manifest's exact base SHA.

Before approving implementation fan-out, require a clean source checkout. A
dirty checkout has no reproducible base for sibling worktrees. Stop and ask the
user to commit the required state. Never stash it, copy its patch, or silently
fall back to parallel edits in one checkout.

Use `dispatch/<run-id>/<assignment-id>` for generated branches. Default the
base to current `HEAD`; show an explicit `main` or other override in the
manifest when requested.

## Launch the ready wave

Run the bundled launcher rather than reproducing tmux keystrokes:

```bash
python3 scripts/dispatch.py check --manifest "$manifest"
python3 scripts/dispatch.py launch --manifest "$manifest"
```

Use `--wave N` when the user approved a numbered wave. On a recorded failure,
inspect its pane if one exists, then retry only that assignment:

```bash
python3 scripts/dispatch.py retry --manifest "$manifest" --assignment <id>
```

The launcher uses `agent` for readiness, stable names, prompting, and start
verification. Claude enters planning through its launch flag. Codex changes
mode only after an observed idle screen and must display `Plan mode` before
the prompt is sent. A prompt visible in the composer is not evidence that the
agent started.

Permission bypass is never a default. Preserve normal provider permissions
unless the approved manifest explicitly says `bypass` for that assignment.

If a launch fails, stop the wave. Keep successful panes, record the failed
assignment, and do not launch the remaining assignments. Never delete a pane
or worktree as failure recovery.

## Hand control back

Report the manifest path and one bounded table with assignment, provider, mode,
agent name, tmux window, checkout, and recorded state. Give the user:

```bash
agent ls
agent goto <agent-name>
```

Stop there. Do not answer child agents, monitor them, collect their plans,
launch later waves, merge branches, open PRs, or clean worktrees unless the
user starts that separate workflow.

`evals/evals.json` contains human-reviewed trigger and behaviour cases. It is
test material, not runtime guidance.

The launcher's manifest, lifecycle, isolation, and failure behaviour are pinned
by `tests/test_dispatch.py`. Run `pytest -q` from the skill directory after
changing the launcher.
