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
The current durable state of a run (`run.json`) - status, budget, logs, phases,
result. Overwritten in place as the run progresses.
_Avoid_: state file, record

**Journal**:
The append-only `journal.jsonl` of `agent_started`/`agent_result` entries that
drives deterministic replay on resume.
_Avoid_: log (that word is reserved for user-facing `log()` output), history

**Replay key**:
The chained `v2:sha256(...)` identity of an `agent()` call. Matching keys reuse a
journalled result instead of relaunching the subagent.
_Avoid_: cache key, hash

**Agent**:
A Pi coding-agent subagent launched by an `agent()` call within a workflow. Runs
with the coding toolset; may be schema-constrained via structured output.
_Avoid_: worker, subprocess, tool

**Defence-in-depth VM**:
The `node:vm` context a workflow body runs in. Enforces determinism and contains
accidents; explicitly not a security boundary (see ADR 0001).
_Avoid_: sandbox (implies a boundary it does not provide)
