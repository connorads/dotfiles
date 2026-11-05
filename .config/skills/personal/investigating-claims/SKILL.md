---
name: investigating-claims
description: >-
  Investigates a quantitative claim about a population - "X% of group Y do Z",
  "group A is over-represented in B" - with a reproducible census or sample,
  fair comparison groups and a layered plain-English report. Use when
  fact-checking a viral statistic, auditing a claimed share, rate or
  over-representation, choosing a baseline or comparison group, steelmanning
  both readings of a disparity, or turning an analysis into a report for
  non-specialists. Not for judging a single conclusion's evidential strength
  (prove-it) or for prose editing alone (govuk-style).
---

# Investigating claims

> **Out of what, compared with what - and what result would change my mind?**

Every step below serves that question. A number without a denominator, a
baseline, or a pre-stated way to be wrong is not yet a finding.

## 1. Pose the problem

- Restate the claim as estimands: numerator, denominator, unit, place, date.
  Quote the original words and record what its author did not publish
  (method, data, date of snapshot).
- Split the claim into separate hypotheses and keep them separate to the end:
  the proxy you can measure, the trait it stands in for, the behaviour the
  claim implies, and the comparison it makes. Answering one never answers
  another.
- Fix the unit of analysis. A share of entities (companies, households) and a
  share of people are different quantities: an entity with three members has
  three chances to count. Compute both when the claim mixes them.
- Before computing, write down which result would support each reading and
  which would undercut it. Store this pre-registration next to the code.

## 2. Measure the whole thing

- Prefer a census of the target population over a sample. Keep the raw source
  unchanged with URL, retrieval time and SHA-256.
- Never drop an unresolved unit. Keep it in the denominator with a reason
  code, then report bounds: every unresolved unit negative, every one
  positive, and a modelled middle. Add the threshold sum: how many units must
  flip to reach the claimed figure, and whether that exceeds the unresolved
  count.
- A partial run in source order is not a sample. Do not report a prefix as if
  it were representative.
- Census counts get no sampling interval. Samples do. Say which is which.

## 3. Validate every proxy

When the trait is inferred (from names, addresses, codes, keywords):

- Make the proxy transparent and deterministic: versioned lists or rules, no
  model guesses at runtime, and a strict and a broad variant.
- Validate on labelled data held out from the data used to build the proxy.
  Report sensitivity and specificity in words ("finds about 6 in 10; wrongly
  includes about 1 in 200").
- Add an in-population anchor: a subgroup of the real data whose trait rate is
  known from an external source, to check the proxy where it is actually used.
- If the validation set does not resemble the target population, say the
  direction and size of the error are unknown. Do not guess "probably a
  little higher".
- Any model-based correction is a scenario. Report which input assumption it
  needs to reach the claimed figure.

## 4. Design comparisons that could falsify

- Compare like with like: the same unit, the same place, the same date. A
  share of entities against a share of residents is not a comparison.
- Choose comparison cases that could break the explanation, not only ones
  that resemble the headline case. If the effect is thought to track a local
  factor, include cases where that factor is small.
- Test specificity with sibling groups. If the effect appears for every
  similar group, it is a general mechanism, not a property of one group.
  Include a group expected to go the other way.
- Report unadjusted and adjusted results, and how much of the gap the
  measured covariates explain.
- Keep P(trait | outcome) and P(outcome | trait) apart, and say which one the
  claim is about.
- An association is not misconduct. Test the behaviour the claim implies with
  its own markers, within strata, against the comparison group. Report
  circumstantial markers only in aggregate.

## 5. Argue both sides, then weigh them

- Write the strongest case for each reading, each argument with its numbers
  and a strength rating (strong, moderate, weak, none).
- End with a weighted bottom line, not false balance. Separate "the data
  shows no difference" from "the data cannot tell".
- List the records that would settle the open question and whether they can
  be requested.
- Get an independent adversarial review that recomputes the headline numbers
  with its own code.

## 6. Report in layers

Read [references/report-layout.md](references/report-layout.md) before
writing the reader-facing report. Its rules in one line: a stranger must know
the claim, the method and the answer from the first screen, and every number
must say out of what and compared with what.

## 7. Delegated and automated work

When subagents or scripts do the legwork:

- Check that each deliverable contains the measurement, not scaffolding that
  marks it "not estimable". A worker that declines a step must say so; the
  coordinator then does the step or reports the gap.
- Scrapers respect rate limits and pause and resume on blocks; a block is not
  a reason to stop for good. Confirm a background job actually started.
- Every published number is generated from a machine-readable results file
  and checked against it by a script.
- Publish aggregates only when the inferred trait is sensitive; keep
  person-level data private.

## References

| When | Read |
|---|---|
| Writing the reader-facing report or web page | [references/report-layout.md](references/report-layout.md) |
| Stating how strongly the evidence supports the verdict | the `prove-it` skill |
| Prose style for public text | the `govuk-style` skill |
