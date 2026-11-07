---
name: ui-hill-climb
description: >-
  Improves an existing app's appearance, usability and responsiveness over
  several bounded rounds without supervision. Use when asked to improve or
  polish a running app overnight, hill climb a UI, run a design or model review
  council on an app, or make an app look and feel better across rounds. Not for
  one known fix, designing a new flow (ui-design), diagnosing first load alone
  (web-perf), or a single design critique.
---

# UI Hill Climb

> **What can a user now do, or do faster, and which fair comparison proves it?**

Every decision in a run returns to this question. Model scores do not answer
it. They stayed flat while serious findings kept arriving, and they drift with
comparison context and with any target the reviewer can see.

Improve what exists. Keep the app's features and interfaces, and add no
dependencies. A new feature or a changed API is a question for the user, not a
finding to fix. Treat a written design rule as the default. When it blocks a
clearly better flow, stay within it and propose the change with your evidence.

Data loss, misfiled records and broken task flows deliver the most value.
Responsiveness comes next and polish last, even when the request sounds
cosmetic. Rank the backlog in that order.

## First five minutes

Do these steps in order, before any other work.

1. Confirm the target repo by path. Confirm which process owns the port you
   plan to use.
2. Load the repo's own toolchain.
3. Launch a browser, open a page and take a screenshot.
4. If Chromium fails with `bootstrap_check_in ... Permission denied (1100)`,
   launch it with `--single-process`, which starts inside macOS Seatbelt. Give
   every reviewer the same flag. For any other failure, try the route this
   environment approves. If that route is refused, stop and ask. Keep the work
   that needs no browser, such as checks and the harness.
5. Write down the limits: rounds, time and spend. When none are supplied, use
   three rounds and record that default.

A refusal from a permission system is an answer. Do not retry it through a
subagent, a wrapper or a workflow worker. Do not tell reviewers to find a way
round it.

When a browser cannot run, stop before changing the UI. Unseen visual changes
fail the question above.

## Baseline

Run every check before you touch the code, and record the existing failures.
A check runner that stops at its first failure hides the later suites, so run
those suites separately. Run the repo's existing audits and probes now, not
only at the end.

Build the harness next. Read [references/harness.md](references/harness.md)
before you write it.

Exercise interrupted journeys as well as happy paths. The worst defects in
these runs appeared only here:

- The reply is lost, then the user leaves or retries.
- The user taps repeatedly, or acts during a save.
- The user acts inside a sub-area, such as a group or a modal. Check where the
  record lands and where the user returns.
- The user closes or goes Back with typed input.
- Undo runs after other actions have happened.

## A round

One round is complete only when it has all of these:

1. A small coherent change set, committed as each unit passes its gate.
2. The changed flows exercised in the running app.
3. The same screens captured with the same content and viewports.
4. Fresh reviews of a frozen target. Read
   [references/reviews.md](references/reviews.md) before the first review.
5. Each finding reproduced by the coordinator, then fixed or rejected with a
   reason.

Skipping capture or review means the round did not happen. Report it as
skipped.

A quieter round does not prove the app is clean. In two of four full runs the
most serious bug arrived in the last round, and many later findings were
regressions from the run's own fixes. Tell each round's reviewers to look at
the fixes made so far.

**Stop rule.** Stop at the round limit, or at the time or spend limit, or when
a full round produces no substantiated High or Medium behaviour finding. A
round with fewer commits is not a stall.

**Last fixes.** Fixes made after the final review get one scoped re-review of
those commits only. If you skip it, name each unreviewed commit in the report.
Recapture the final commit, or show that its bundle hashes match the last
capture.

**Measurement.** Read [references/measurement.md](references/measurement.md)
before you record a timing. Treat every first result as suspect.

## Standing rules

- Commit with `<gate> && git commit`, on one command line. A commit chained
  after an unchecked gate lets failures through. Never pipe the gate, because
  `| tail` hides its exit code.
- A harness step that exits non-zero makes its results invalid, even when its
  output looks complete.
- Commit each verified unit as you go. Splitting one mixed change into commits
  at the end of a round costs more than the round's polish delivered.
- Do not edit the code that reviewers are reading. Freeze a build and a commit
  range, or tell them which paths are moving.
- Run timing alone. Reviewers and timing runs compete for the machine.
- Reviewers write only reports and their own harness files, never the app.
- Prefer the smaller fix. When client code grows to work around a missing
  server feature, stop and make it a decision. Two runs took a 25-line client
  to 395 and 506 lines this way.
- Never weaken a test to pass. When a test pins behaviour you changed on
  purpose, update it and say so in the report.
- Never push, deploy or merge. The user decides that after the report.

## Decisions without a human

Nobody is awake to answer. Make the design and usability calls yourself, and
record each one. For a hard call, build real alternatives with
`design-forking`, have fresh reviewers compare them under neutral labels, and
pick one. The user delegated these calls by starting the run.

Leave these alone and put them in the report: money or domain logic,
compatibility of exposed interfaces, and conflicts between written specs. A
reviewer finding that disagrees with a written spec does not settle it.

## The report

Include:

- Before-and-after screenshot pairs with the same content and viewport.
- Behaviour fixed, in user terms, with data and money fixes first.
- A measurement table with the method and sample count. Name any figure you
  retracted during the run.
- Checks passed, failed and skipped. Existing failures stay distinct from new
  ones.
- What was never tested, such as other browsers, real devices and screen
  readers.
- Each test changed, and why.
- Each commit not reviewed, by hash.
- Decisions for the user. See the rule below.
- Remaining issues and the surfaces you did not cover, such as admin screens,
  as one batch the user can approve with a word.
- Commits, and the commands to run the result.

Write each decision for a reader who saw none of the run. Give a concrete
example in user terms, the choices, your recommendation and what you will do if
the user accepts it. Two decisions in one real report came back as "Don't
understand question" and "explain". Keep this list to calls only the user can
make.

Close browser sessions and stop harness servers. List anything left behind.

## Neighbouring skills

Load one when a finding needs it: `ui-design-playbook` for visual rules,
`accessibility` for keyboard and screen reader fixes, `web-perf` for first
load, `ui-design` for reshaping a task flow, `pr-before-after` to put the
comparison in a pull request, and `prove-it` to test a doubtful claim.

## References

| When the task involves… | Read |
|---|---|
| Fixtures, a stack that will not start, capture lists | [references/harness.md](references/harness.md) |
| Timing an interaction, comparing two builds | [references/measurement.md](references/measurement.md) |
| Briefing reviewers, freezing targets, judging findings | [references/reviews.md](references/reviews.md) |

`evals/` holds this skill's test prompts and fixtures.
