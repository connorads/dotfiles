# Scoring and report

`score()` in `scripts/probe.py` computes every number here. This file says
what the numbers mean and how to lay out the report. Never compute a score by
hand. Fold judgements in with `--judged` and read the numbers the probe prints.

## Contents

- [Statuses](#statuses)
- [The two scores](#the-two-scores)
- [Folding in judgements](#folding-in-judgements)
- [Re-runs](#re-runs)
- [Report template](#report-template)

## Statuses

| Status | Meaning | Counts toward scores |
|---|---|---|
| `pass` | The outcome holds; `evidence` names the files | yes, as `numerator/denominator` |
| `fail` | The outcome does not hold; `detail` says what is missing | yes |
| `judge` | The probe cannot decide; `detail` is the question, `evidence` the files to read | no, until judged |
| `skip` + `not_applicable` | The criterion does not fit this repo (no database, single package) | no |
| `skip` + `environment` | Needs forge access or a tool on this machine | no, but reported apart |

A criterion normally scores 1/1 or 0/1. For an application-scoped criterion
in a repo with several apps, judge it as a fraction: `2/3` means two of three
apps pass.

## The two scores

**Gated level (the headline).** Level N is reached when at least 80% of the
scored criteria at levels 1 to N pass, counted cumulatively, and every lower
level also holds. A repo with a failing level 1 is at level 0, whatever it has
at level 4. `gate_gap` is the number of extra passes, at or below the next
level, needed to reach it.

**Flat score.** The mean of per-criterion fractions over the scored core
criteria. Levels come from 20% bands: under 20% is level 1, and 80% or more is
level 5. Extension criteria (`origin: extension`) are left out, so the flat
score stays stable as extensions are added. `checks_to_next_level` is the
number of extra passes that reach the next band.

**Environment skips.** They are left out of both scores and counted in
`env_skipped`. When there are any, the probe also prints the range the
flat score would fall in once they are checked: all failing to all passing.
Report that range. Never turn a missing credential into a repo failure.

## Folding in judgements

Write a JSON object keyed by criterion id to a scratch file outside the repo:

```json
{
  "single_command_setup": {"status": "pass", "detail": "README: `mise install && pnpm i && pnpm dev`", "evidence": ["README.md"]},
  "pii_handling": {"status": "skip", "cause": "not_applicable", "detail": "CLI tool; handles no user data"},
  "interactive_qa_exists": {"status": "fail", "numerator": 1, "denominator": 2, "detail": "web app documented, worker not"}
}
```

Then run `scripts/probe.py <repo> --judged <file>`. `status` is `pass`, `fail`
or `skip`. `cause` applies to skips only and defaults to `not_applicable`.
`numerator` and `denominator` default to 1/1 for a pass and 0/1 for a fail.
An unknown id or a bad value exits 2 and names the problem.

Any criterion can be overridden this way, not only `judge` ones. Override a
probe verdict only when the cited evidence is wrong, and say why in `detail`.

## Re-runs

A saved snapshot is only a baseline to diff against. Save it with
`--json --judged <file>` so it holds the judgements, not pending items. Run the
probe fresh, judge, then pass the old snapshot as `--previous <file>`. The
probe lists real status changes under `CHANGED`, and items judged in only one
run in a separate section: those are not repo changes. Do not read the old
report before judging: a new judgement stands on the files as they are now.

## Report template

Print this to the user. Keep each gap to one line.

```text
Agent readiness: <repo> @ <commit>

Gated level: <N>/5 - <gate_gap> more passes at L<=N+1 reach L<N+1>
Flat score: <pct>% (level <L>)[; <a>-<b>% once <k> environment checks run]

Level  Passed/Scored
L1     x/y
...

Blocking the next level (lowest level first):
- L1 gitignore_comprehensive: .gitignore misses node_modules -> fix inline
- L2 pre_commit_hooks: no local gate -> hk skill (or extend the repo's hook manager)
...

Not applicable: <ids, comma separated>
Environment (not a repo fault): <ids>; run with `gh` signed in to check them
Judged by the agent: <id: one-line reason>, ...
```

Order gaps by level, lowest first, because the gate blocks on the lowest
failing level. Within a level, put the one that best answers the north-star
question first.
