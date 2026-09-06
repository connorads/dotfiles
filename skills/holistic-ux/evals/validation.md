# Validation record

Date: 7 September 2026

## Method

Each run started in a fresh temporary project containing the candidate skill at
the client's native project-skill path. Codex ran with a read-only sandbox.
Claude ran with shell, write, edit and web tools denied. No conversation or
generated artefact carried between repetitions.

- Codex CLI: 0.153.4, configured default model. The JSONL trace did not emit a
  model identifier.
- Claude Code: 2.1.261, `claude-fable-5-1`.
- Every held-out behaviour and trigger prompt ran three times per client.
- Behaviour grading used the assertions and required reads in `evals.json`.
- Trigger grading used the trace: reading `holistic-ux/SKILL.md` in Codex or a
  `Skill` call for `holistic-ux` in Claude counted as a trigger.

Early Claude runs did not expose the project skill, and later runs shared files
between repetitions. Both batches were discarded. Trace inspection found the
fixture defects before their outputs were graded.

## Behaviour results

The baseline failed the two central evidence tests. Both bare and existing-skill
runs invented an emotional journey from aggregate analytics. The existing skill
also promoted sparse inputs into authoritative patterns, structure and
assumptions.

The first candidate exposed three pressure failures:

- named laws became post-hoc support for a fixed checkout design
- requested cancellation obstruction survived inside an otherwise compliant
  flow
- product-discovery work was completed before the response named the boundary

Those exact rationalisations became prohibition tables. The final held-out
result was 3/3 on both clients for each rerun case:

| Eval | Codex | Claude | Elapsed seconds per run |
| --- | --- | --- | --- |
| Thin-evidence journey map | 3/3 | 3/3 | Codex 57-60; Claude 54-76 |
| Coercive cancellation | 3/3 | 3/3 | Codex 32-36; Claude 52-70 |
| Named laws under authority pressure | 3/3 | 3/3 | Codex 23-25; Claude 36-41 |
| Product-discovery route-away | 3/3 | 3/3 | Codex 15-23; Claude 26-50 |

The harness retained elapsed time and full JSONL traces. Exact token totals were
not comparable because Claude and Codex report usage through different event
shapes, so none are claimed here.

## Trigger results

Final held-out trigger results:

| Client | Positive | Negative | Total |
| --- | --- | --- | --- |
| Claude | 9/9 | 9/9 | 18/18 |
| Codex | 9/9 | 3/9 | 12/18 |

Codex correctly ignored the software data-flow prompt 3/3. It still loaded the
skill for React implementation and presentation-polish prompts 3/3, then routed
them away from the body. Several description variants moved the false-positive
rate without eliminating it. The checked-in description keeps the positive
boundary at 9/9 and omits production keywords that caused broader collisions.
This remaining client-specific over-trigger is visible rather than hidden by a
hand-edited score.
