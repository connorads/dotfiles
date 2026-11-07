# Reviews

Reviewers find what the builder cannot see. They also inherit any bias you hand
them. In these runs they caught the wrong record being removed, double-recorded
payments and regressions from the builder's own fixes.

## Contents

- [Set up each round](#set-up-each-round)
- [What each reviewer receives](#what-each-reviewer-receives)
- [Brief](#brief)
- [Judge the findings](#judge-the-findings)
- [Scores](#scores)

## Set up each round

Use one fresh agent per role: visual, usability and engineering. Reuse nothing
from an earlier round.

Freeze the target first:

1. Build to a round folder and serve it on a review port.
2. Pin the commit range for engineering.
3. Copy the review material to a new folder that holds only this round, away
   from earlier reports. An instruction not to read them is weak when they sit
   one folder away. Do not change permissions on the user's folders.
4. Keep the review server up, and leave the code alone until reports return.
   If you must keep working, tell reviewers which paths will move.
5. Give each reviewer exact URLs. A port range sent one reviewer's writes to
   other projects' servers.

## What each reviewer receives

| Role | Receives |
|---|---|
| Visual | Current screenshots, design system or spec, supplied visual references |
| Usability | Served URL, driver library, journeys, list of what the harness fakes |
| Engineering | Pinned commit range, copy of the code, repo instructions |

Hide previous reviews, scores, target scores and the round number.

Hide the before state unless the question is "which is better?". Labelled
Before and After shots drew six out of six "improved" verdicts. A reviewer who
saw baseline shots raised three regressions, and one was false. For a
comparison, use neutral labels A and B and shuffle them, then decode the labels
yourself.

## Brief

Fill in the brackets. Do not add a goal, a score or the history of the run.

```text
You are reviewing the [visual design | usability | engineering] of [app],
for [users and main tasks]. You did not build it.

Target: [frozen URL, screenshot folder or commit range]. [Other agents may edit
these paths: ...]
Do not change the app. Write only to [report path].

Criteria:
- Visual: hierarchy, typography, spacing, colour, consistency.
- Usability: navigation, feedback, accessibility, task completion, recovery
  from interruption and failure.
- Engineering: correctness, regressions, responsiveness, unnecessary rendering,
  test quality. Look hardest at retries, double submission and state after
  failure.

For each finding give: what you saw, where, the steps or file and line that
show it, the harm to a user, and the severity. Separate defects from
preferences. Rank by harm. Report every finding you can substantiate.

End with: what clearly works, and what you did not cover.
```

Do not cap the number of findings. A cap of fifteen silently dropped real items.

## Judge the findings

Reproduce each finding before you act on it. Reviewers are usually right about
what they saw and sometimes wrong about why.

- **Harness artefact:** a fake or a seed caused it. Fix the harness and note it.
- **Existing behaviour:** called a regression, but present at baseline. Check
  the baseline build.
- **Stale:** fixed after the snapshot. Note it and move on.
- **Spec conflict:** the spec decides. If two specs disagree, report it to the
  user.
- **Preference:** record it. Act when two reviewers raise it, or when it recurs
  across rounds.

Speculation about performance needs a measurement. A reviewer's suspicion of
lag is not a finding until a timing shows it.

Use mutation to test a claim of test coverage. One test passed while most of
its mutations survived, and a reviewer found this by mutating the code.

Keep a list of rejected findings with reasons, so the next round's work does
not repeat them. Do not pass that list to reviewers.

## Scores

Collect a score if the user wants one, and use it only to compare builds under
identical conditions. Stop judging a round by it. Flat sevens sat beside new
High findings, and one reviewer rated the same state 4 at the end of a round
and 3 at the start of the next. Counts of substantiated findings by severity
told rounds apart better.
