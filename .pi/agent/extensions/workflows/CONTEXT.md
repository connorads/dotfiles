# Pi Workflows

A Pi extension that runs Claude-compatible dynamic workflows: model-generated
JavaScript that orchestrates subagents in the background, with durable snapshots
and deterministic replay.

## Language

**Workflow script**:
The JavaScript source of a workflow - a pure `export const meta = ...` followed
by an async body that calls the DSL helpers. Model-generated, persisted verbatim
as the run's pinned source.
_Avoid_: program, template, recipe

**Run**:
One execution of a workflow script, identified by a `wf_...` run id, with its own
durable snapshot, pinned script, and replay journal.
_Avoid_: job, task, instance

**Snapshot**:
The current durable state of a run - status, tool policy, agent observations,
budget, logs, phases, result. Overwritten in place as the run progresses.
_Avoid_: state file, record

**Journal**:
The append-only `journal.jsonl` of `agent_started`/`agent_result` entries that
drives deterministic replay on resume.
_Avoid_: log (that word is reserved for user-facing `log()` output), history

**Replay key**:
The chained `v3:sha256(...)` identity of an `agent()` call - previous key,
prompt, and selected options each hashed separately before the outer hash.
Matching keys reuse a journalled result instead of relaunching the subagent.
_Avoid_: cache key, hash

**Stall watchdog**:
The progress-based per-agent timer: session events (message deltas, tool
executions, turn starts) reset it, so only a genuinely silent agent is aborted
(`stallMs`, default 180000 ms; `<= 0` disables).
_Avoid_: timeout (a flat deadline is exactly what it is not)

**Agent**:
A Pi coding-agent subagent launched by an `agent()` call within a workflow. Runs
with the run's tool allowlist; may be schema-constrained via structured output.
_Avoid_: worker, subprocess, tool

**Tool allowlist**:
The parent Pi session tools captured for workflow agents at launch or resume,
after workflow-control tools are excluded.
_Avoid_: tool profile, permissions preset, all tools

**Budget cap**:
An optional positive output-token cap declared by `meta.budget`. Missing,
non-positive, or invalid budget values mean the run is uncapped.
_Avoid_: token target, quota, estimate

**Workflow menu**:
The interactive `/workflows menu` view for choosing a run and inspecting its
status, phases, agents, logs, result, and available run actions.
_Avoid_: dashboard, control panel, TUI

**Defence-in-depth VM**:
The `node:vm` context a workflow body runs in. Enforces determinism and contains
accidents; explicitly not a security boundary (see ADR 0001).
_Avoid_: sandbox (implies a boundary it does not provide)
