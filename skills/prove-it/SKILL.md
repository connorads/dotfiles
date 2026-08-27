---
name: prove-it
description: >-
  Disciplines the inference behind a conclusion: whether the evidence
  gathered actually entails the claim being made. Use when declaring a bug
  fixed or a root cause found, closing an investigation, verifying that a
  fix worked, auditing a diagnosis or conclusion (yours, a ticket's, another
  agent's), or when the user says prove it, are we sure, or asks whether the
  evidence really supports this. Not for forward-looking bets on what to
  build or ship - that is deciding-under-uncertainty.
---

# Prove It

> Would this observation look any different if your conclusion were false?
> If nothing about it would change, it is not evidence for the conclusion -
> however much of it you have, and however well it fits.

A conclusion is **load-bearing** when it will drive an action, close an
investigation, or be reported as fact. Load-bearing conclusions go through
the protocol. Everything else needs only the question above.

## The protocol

Each step produces something stated, not just thought.

1. **State the claim with its modality.** *Is/was* (actuality), *could/can*
   (disposition), *will* (prediction). Then check the evidence matches:
   reading code proves what a system *could* do; only observing the running
   system - logs, traces, live config, state - proves what it *is* doing. A
   precise, well-cited answer to the wrong-modality question is still no
   answer; precision is not relevance.

2. **Audit inherited premises.** Every premise arriving in the prompt, the
   ticket, a summary, or your own earlier turn is a claim, not a fact. Check
   the ones your conclusion stands on before building on them, and report a
   false one promptly. The reporter's diagnosis - including yours from an
   earlier session - is Hypothesis #0: a lead ranked alongside the others,
   not a finding that others must dislodge.

3. **Enumerate rivals.** Name at least two live alternatives before any
   definitive cause. If stuck, sweep categories: config, data, deploy,
   dependency, concurrency, caching, permissions, clock, network, resource
   limits. Search for rivals already written down (an old ticket, a closed
   issue, a comment) - the strongest rival is often recorded and unread.

4. **Check diagnosticity before running a check.** For each possible
   outcome, write down which hypotheses it would rule out. If every outcome
   is compatible with every live hypothesis, the check is activity, not a
   test - redesign it. The commonest failure: the check never exercises the
   suspected mechanism in the suspected environment, so its result is
   uninformative whichever way it lands. A deploy that touches no production
   code cannot test a production-code hypothesis; a quiet weekend after it
   proves nothing (affirming the consequent).

5. **Label the chain.** Mark each link of the argument: **observed** (you
   saw it - cite the command, file, or line), **derived** (follows
   necessarily from an observed link, not merely plausibly), or **assumed**
   (unchecked - name what would check it). The conclusion inherits the
   weakest label in its chain, and a conjunctive claim is exactly as strong
   as its weakest conjunct - never average confidence across parts.

6. **Report with the basis inline.** A load-bearing conclusion names the
   observation that entails it and what was ruled out, in a sentence or two.
   Absence claims are bounds, not facts: a search that ran and found nothing
   is a null result - state the queries and what they rule out; a search you
   did not run is a blind spot - report it as a gap, never as a null result.
   For "it stopped happening": zero events in n independent trials bounds
   the rate near 3/n, so state n and the window, and say whether the
   historical rate even falls above that bound.

## The stop rule

A conclusion whose chain still contains an *assumed* link where *observed*
is needed does not drive an action and is not reported as fact. Report
instead what observation would settle it, and go get that observation where
you can. "I cannot rule out X, because nothing yet discriminates it" is a
complete, useful answer - not a failure to answer.

## Fix claims

The everyday load-bearing conclusion is "it's fixed". It needs one of:

- **The toggle.** Reproduce the failure under the original conditions,
  apply the fix, observe it pass; remove the fix, observe it fail again. If
  you didn't see it fail, you don't know your fix is what fixed it.
- **A bounded quiet period** with the arithmetic stated (the 3/n rule
  above), trials genuinely independent, and a detector installed on the
  suspect path so a recurrence is observed rather than hoped absent.

A symptom that stops after a change that cannot reach the suspect path is
grounds for more suspicion of a timing-dependent cause, not less.

## Revision rule

Change a conclusion only when a new observation arrives, and name it when
you do. Pushback, doubt, or "are you sure?" carry no information about the
system; if you cannot name a new observation, restate the conclusion and
the evidence behind it. Conceding to unbacked pressure is not politeness,
it is corrupting the record.

## Independent means different

A second check confirms the first only if it could have failed where the
first could not: a different evidence channel, a different framing, or a
different failure mode probed. Two readers of the same fenced evidence
under the same framing are one vote, not two. Verified sub-claims do not
launder the unverified one they are conjoined with.

## The counterweight

Rigour that manufactures doubt is its own failure, not a safe excess:

- A doubt must name the claim it attacks and the mechanism, and pass
  "would resolving this change the conclusion, or only the wording?" A
  doubt that fails the test is dropped, not kept as a hedge.
- Clearing a claim as sound is a complete, expected result. Locate residual
  uncertainty precisely rather than smearing hedges over the whole answer.
- After three checks that fail to discriminate the live hypotheses, stop:
  report what is established, what remains open, and the observation that
  would decide it.

## Rationalisations

Excuses observed in real investigations, each with its rebuttal:

| You will think… | But actually… |
|---|---|
| "The mechanism exists in the code, so that's what production is doing" | Code is disposition. Whether that path runs is decided by flags, env, and data living outside the repo - observe them. |
| "Five separate signals all point at this cause" | Count only signals a rival cannot also explain. Zero-diagnosticity signals sum to zero however many you stack. |
| "The ticket already established the cause; I only need to confirm it" | That is Hypothesis #0 plus a confirmation plan. Rank it against rivals and look for what would disconfirm it. |
| "Two investigations agree, so it's confirmed" | Same framing plus same evidence is one vote (a common-mode failure), not independent confirmation. |
| "It stopped after the deploy, so the fix worked" | Post hoc. Either run the toggle or bound the quiet period; a coincidence in time licenses neither. |
| "The user is pushing back, I should soften the conclusion" | Revise on new observations only. Name the observation or restate the evidence. |

## Boundaries

- **deciding-under-uncertainty** owns forward-looking commitments ("should
  we?"); prove-it owns backward-looking claims ("is it?"). Hand off when
  the question flips.
- **testing** owns how to build a test; prove-it owns whether the test that
  ran discriminates anything and what a green run licenses.
- **design-forking** widens options for a design; prove-it's rival
  enumeration exists to be *eliminated by evidence*, not compared on
  trade-offs.
- **cross-review** is the escalation when your own checks cannot
  discriminate: a different model reading the primary evidence fresh.
- **refactoring** owns changing legacy code safely; prove-it owns knowing
  what you actually know about it first.

## References

| When the task involves… | Read |
|---|---|
| Classifying a suspected reasoning failure; the full failure-mode → discipline map with classical names | [references/failure-modes.md](references/failure-modes.md) |
| Seeing the protocol applied end-to-end to a realistic incident | [references/worked-example.md](references/worked-example.md) |
