---
name: prove-it
description: >-
  Tests whether evidence warrants an empirical claim at its stated strength
  and scope. Use when declaring a bug fixed or a root cause found, closing an
  investigation, validating or verifying a factual conclusion, auditing the
  factual premises of a plan, or when the user says prove it, are we sure, or
  asks whether evidence really supports a claim in any domain. Not for
  mathematical or formal proof, type-system guarantees, choosing among
  forward-looking options, or designing the test itself.
---

# Prove It

> What result did each live explanation predict, and how should this
> observation change their relative weight?

Use the full protocol for a load-bearing claim: one that drives an action,
closes an investigation, or will be reported as fact. For a minor claim, ask
the question above and state the evidential strength.

## The protocol

Each step produces something stated, not merely considered.

1. **State the claim, scope and strength.** Distinguish actuality (*is/was*),
   disposition (*could/can*) and prediction (*will*). Use calibrated language:
   **confirmed within stated conditions**, **likely**, **possible**,
   **bounded**, or **unknown**. Empirical evidence warrants a claim; it rarely
   entails it. Reading code establishes what a system could do. Logs, traces,
   live config and state address what it is doing.

2. **Audit inherited premises and priors.** Treat every premise from a prompt,
   ticket, summary or earlier turn as a claim. Check the load-bearing ones and
   report a false one promptly. Include relevant base rates. The reporter's
   diagnosis, including yours, is Hypothesis #0 rather than a fact.

3. **Validate the evidence channel.** Before asking what a signal diagnoses,
   establish its unit and identity, deduplication or aggregation, sampling and
   retention, proxy semantics, time alignment, and detector coverage. Validate
   the detector with a known-positive where practical. A thousand rows may be
   50 retried events. HTTP 200 may show only that a catch handler returned 200.

4. **Compare live rivals and predictions.** Name at least two plausible
   alternatives before declaring a cause. For each possible result, record
   which rivals predict it and which it would weaken. Group signals sharing a
   source or failure path before treating them as additive. If every rival
   predicts the observation, it corroborates the setting but discriminates
   nothing.

5. **Choose a safe, comparable contrast.** Change one candidate cause while
   keeping build, environment, config, input, starting state, window and
   detector comparable. Never restore a harmful production failure merely to
   prove causality. Prefer sandbox, replay, shadow, canary or a valid historical
   contrast. If no safe discriminating observation exists, lower the claim's
   strength and name the unresolved rival.

6. **Label the chain.** Mark material links **observed** (directly seen and
   cited), **derived** (logic or arithmetic from observations), **inferred**
   (best explanation under stated assumptions), or **assumed** (unchecked).
   The weakest load-bearing link limits the conclusion. Confidence in a
   conjunction is not an average across its parts.

7. **Report the warrant and boundary inline.** Name the observation, how it
   shifted the rivals, and the conditions within which the claim holds. A
   search that ran and found nothing is a null result; state its query and
   coverage. A search not run is a blind spot. For zero-event rate claims, read
   [references/null-results.md](references/null-results.md).

## Root-cause and fix claims

For either claim, read
[references/failure-modes.md](references/failure-modes.md) before concluding.

A useful causal account separates the trigger, proximate mechanism,
contributing conditions, failed defences and intervention points. Mark a
factor necessary, sufficient or merely present only where evidence supports
that relation. Do not compress a multi-factor incident into one tidy culprit.

"Fixed" can mean several different things. State which one the evidence buys:

- the reproducer passes under stated conditions;
- the candidate change caused that result;
- the defect was removed rather than masked or mitigated;
- production recurrence is bounded over a stated exposure;
- related failures or general correctness are covered.

A sound ABA toggle - fail with the candidate off, pass on, fail off again - is
strong causal evidence only when the runs are safe and comparable. A quiet
period supports a recurrence bound only when event identity, denominator,
independence and detector coverage are valid. Neither alone proves general
correctness.

## Stop and revise

Stop when the target strength is reached, no safe feasible observation is
expected to change the decision enough, the agreed resource bound is reached,
or decisive evidence is inaccessible. Do not stop after a fixed number of weak
checks. Report what stands, what remains open and why further work has low or
unavailable decision value.

Revise when a new observation arrives or when logic, arithmetic, provenance or
an assumption is corrected. Name the changed link. Pushback or "are you sure?"
alone carries no information; restate the evidence if nothing material changed.

## Rationalisations

| You will think... | But actually... |
|---|---|
| "I saw 1,000 rows, so I saw 1,000 events" | Establish the observation unit, identity and retry or aggregation semantics before counting evidence. |
| "The request returned 200, so the write succeeded" | A proxy inherits its implementation boundary. Inspect what the status measures and verify the downstream state. |
| "The vendor documents this exact failure mode and the symptoms fit" | Compatibility raises a hypothesis. Compare the same symptoms against live rivals and base rates. |
| "The system is healthy now, so the transient rival is ruled out" | A later check cannot settle an earlier state without a valid time bridge. Align the observation window. |
| "Five signals agree" | Signals derived from one source or failure path are common-mode evidence, not five independent votes. |
| "It stopped after the deploy, so the fix worked" | Hold other changes constant or report only temporal association and a bounded quiet period. |
| "The user pushed back, so I should soften it" | Revise on changed evidence or reasoning, not social pressure. |

## Boundaries

- **diagnosing-bugs** owns reproducing, minimising and navigating the
  investigation. Prove-it owns what the resulting observations license.
- **testing** owns test design and layer choice. Prove-it owns whether the test
  that ran discriminates anything and what a green result warrants.
- **deciding-under-uncertainty** owns choices and predictions. Prove-it may
  audit empirical premises inside a plan without choosing the plan.
- **typescript** and formal methods own compile-time, mathematical and logical
  proof. Prove-it addresses claims about observed systems and evidence.
- **design-forking** widens options for a design. Prove-it's rivals are
  explanations to update using evidence, not options to compare on trade-offs.
- **cross-review** supplies a differently framed reader when your own evidence
  assessment has a common-mode risk.

## References

| When the task involves... | Read |
|---|---|
| A root cause, fix claim, or suspected reasoning failure | [references/failure-modes.md](references/failure-modes.md) |
| Zero observed events, a quiet period, or a rate bound | [references/null-results.md](references/null-results.md) |
| A telemetry incident worked end to end | [references/worked-example.md](references/worked-example.md) |

<!-- Behavioural and trigger evals: evals/evals.json -->
