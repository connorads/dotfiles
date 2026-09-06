# Diagnosis and evidence

Read this for causal diagnosis, research synthesis, conflicting sources,
participant data or research planning.

## Start from the decision

Write the decision in one sentence. Evidence is relevant only when it can change
that decision. Then inventory the available sources without blending them:

| Source | What it can establish | Common limit |
| --- | --- | --- |
| Product analytics | Events, paths, populations and correlations | Usually does not establish motive or cause |
| Observed task session | Behaviour in the tested task and context | Sample and setting limit transfer |
| Interview | Recalled experience, language, belief and meaning | Recall and stated behaviour can differ from action |
| Support contact | A documented problem among people who contacted support | Silent failures and device or segment metadata may be missing |
| Operator report | Delivery practice or a lead about user experience | Check against current operations and direct user evidence |
| Heuristic review | A plausible usability risk in an inspected interface | Does not establish frequency or real-world impact |

Do not rank methods in the abstract. Match the method to the question. Behaviour
versus attitude, qualitative versus quantitative, and natural versus controlled
context are independent choices.

## Claim ledger

For each load-bearing claim, record:

```text
Claim:
Status: measured | observed | reported | inferred | assumed
Source and scope:
Live rival:
Observation that would distinguish them:
```

One source can support several claims with different strength. Label each claim
separately. Preserve disagreements by source and segment instead of averaging
them into a theme.

## Causal restraint

An aggregate event is not its cause. Before recommending a mechanism-specific
change:

1. State the event precisely.
2. Name two or more explanations still compatible with it.
3. Identify an observation that would look different under those explanations.
4. Run or propose the cheapest such observation.
5. Make the recommendation conditional when the result is not yet available.

A test that every live explanation predicts is activity, not diagnosis.

Examples of discriminating observations:

- break one funnel transition into load, interaction, validation and completion
  events rather than treating the whole interval as one abandonment point
- compare the same task across affected and unaffected devices or segments
- observe recent completers and abandoners performing or reconstructing the
  exact task
- inspect error codes and recovery attempts before asking whether users prefer
  a proposed redesign

## Research synthesis

Keep five layers visible:

| Layer | Requirement |
| --- | --- |
| Evidence | Source, context, population and date or window |
| Pattern | Repetition or contrast actually present in the evidence |
| Interpretation | Meaning offered as an inference with live rivals |
| Opportunity | A solution-neutral condition worth improving |
| Design move | A proposal tied to an opportunity and a measure |

Do not skip from a quote, ticket or correlation to a design move. Do not invent
emotional or social jobs. A reported fear can support a fear claim for that
speaker; silence cannot.

For contradictory evidence:

- preserve the source and segment for each side
- check whether the measures cover different behaviours or populations
- state what evidence would reconcile or choose between the accounts
- avoid confidence labels without their concrete basis

## Research safety

Before collecting personal data, write down:

- the decision that requires it and the minimum data needed
- what participants consent to and how consent can be withdrawn
- who can access raw material
- how identifiers are removed or separated
- the retention period and deletion owner
- masking rules for recordings, analytics and session replay
- safeguarding and stop procedures for distressing or sensitive subjects

Recruit beyond convenient successful users when failure, exclusion or assisted
access is material. Do not infer the experience of disabled, low-literacy,
mobile-only or otherwise excluded people without involving them or direct
evidence from their context.

## Output form

```markdown
## Decision

## Evidence
| Claim | Status | Source and scope | Limit |
| --- | --- | --- | --- |

## What remains open
| Rival explanation | Distinguishing observation |
| --- | --- |

## Opportunity

## Recommendation and measure
```
