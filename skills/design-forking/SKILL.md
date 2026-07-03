---
name: design-forking
description: Fork a design decision into genuinely different alternatives before committing - divergent thinking for software design. Use when facing an architecture or design decision, weighing approaches, or planning a non-trivial refactor; when the user asks for options, alternatives or trade-offs; when about to implement the first approach that came to mind for anything hard to reverse; or when reviewing a plan that considered only one design.
---

# Design Forking

First ideas anchor. An agent fixates within a run, and asked for "3 options" it produces three decorations of one idea - a **centroid** with variants. The quality of the design you keep is governed by the best of the set, which rises with the set's *variance*, not just its size. So force structural variance mechanically, then converge in a separate pass. (Research behind each rule: [references/evidence.md](references/evidence.md).)

## 0 - Gate on reversibility

Classify the decision before generating anything:

- **Two-way door** - reversible, cheap to change (a library behind one import, an internal helper, naming). Pick the obvious option, note the reversal path in one line, stop. Forking reversible decisions is process theatre.
- **Can you buy the two-way door?** A module seam, a flag, or an adapter often costs less than a deliberation. If reversibility is cheap to manufacture, buy it and downgrade the decision.
- **One-way door** - expensive to reverse under real uncertainty: schema shape, public API or contract, framework choice, where an invariant is enforced, anything other code or people will couple to. Fork.

Done when: one written sentence names the door type and why. The gate is never skipped because the task "looks simple" - it costs a sentence.

## 1 - Frame

State the decision as the capability or invariant needed, not as a choice between artefacts: "the two surfaces must never disagree", not "shared helper vs base class". Artefact framing pre-anchors the fork on one mechanism. Name the load-bearing dimensions the candidates must differ on.

## 2 - Fork

Pre-commit to N candidates (3-5) before evaluating any of them - evaluation during generation collapses the set back to the centroid.

Assign each candidate a different **axis** of structural difference. Menu (pick what fits, invent others):

- **Enforcement locus** - where does the guarantee live? Types / a boundary parser / a test (including a differential test) / a runtime check / a process or convention. Same invariant, radically different designs - this axis alone usually breaks the centroid.
- **Decomposition boundary** - which module absorbs the complexity; where the seam sits.
- **The null candidate (always include it)** - do nothing, delete code, or change a process instead of building. It prices every other candidate and is sometimes the winner.
- **Buy or adopt** - an existing library, platform feature, or service instead of building.
- **Analogy** - steal the structure from a *named* adjacent domain (how would a ledger, a compiler, a cache shape this?). Intermediate distance works; a random domain hurts.

**Mechanism ban**: after sketching each candidate, name its central mechanism and forbid it for the next candidate. This is the strongest defence against centroid drift.

For one-way doors, generate candidates in parallel subagents with fresh contexts - none may see the others or your leaning. Inline sequential generation with the mechanism ban is fine for smaller forks.

Fidelity: sketch level - the interface as its callers see it, the failure modes, the migration cost. No implementations.

Done when: N sketches exist, each naming its axis, no two sharing a central mechanism, null candidate present.

## 3 - Converge, as a separate pass

Selection is the weak link: the early, feasible, unoriginal candidate wins by default, and a generator judging its own output self-prefers. Counter it:

- Score per attribute - caller-facing simplicity first, then cost of change, failure behaviour, fit with the codebase's existing idiom - never a single overall mark. The named trade-off is the deliverable.
- Apply the deletion test: prefer the candidate that removes the most future obligation.
- Eliminate by demonstrated infeasibility ("needs X the platform doesn't have"), never by early preference.
- On a one-way door, have a fresh-context subagent judge the sketches against the rubric without being told which one you favour.
- Synthesis is a win, not a cop-out: graft a runner-up's best idea onto the winner.

Done when: a recommendation exists with the per-attribute comparison, and every rejected candidate has a stated reason.

## 4 - Record

The losers are the record's value: a decision that lists only the winner cannot defend itself later. Capture considered options and why each lost wherever the project keeps decisions (ADR, design doc, commit message). One paragraph, written now - a post-hoc rationalisation is worthless.

## Present the outcome, not the process

The steps above are your scaffolding; the reader gets their fruits, never a narration of them. A forked answer that reads like a filled-in template ("Step 0: this is a one-way door... now applying the mechanism ban...") buries the analysis in ceremony and makes the reader distrust it.

- Lead with the recommendation, then the candidate comparison, then why each loser lost. Generation order (candidates before judgement) is for you; presentation order is for the reader.
- No step headings, no skill vocabulary (fork, one-way door, mechanism ban, null candidate) in the answer. The gate becomes at most one clause: "this is expensive to change later, so I compared four approaches".
- Present candidates as co-equal sketches, each making its strongest case in the reader's domain language - not strawmen queued behind a foregone conclusion.
- Stay proportionate: the comparison earns its length from the decision's stakes, not from the number of steps you ran.

## Worked example (compressed)

Decision: search results and the RSS feed apply visibility rules independently and have drifted before.

- Gate: silent divergence, user-facing - one-way door. Fork.
- Frame: "the two surfaces must apply identical visibility rules", not "where do we put the shared function".
- Candidates: (a) shared predicate module both call - locus: code seam. Ban "shared function". (b) Differential test seeding fixtures and asserting both surfaces return the same set - locus: test; catches drift in the *queries* too, which (a) cannot. (c) One visibility-filtered view/query both read - locus: data layer. (d) Null: RSS is low-traffic; delete it and serve search-backed links.
- Converge: (b) wins now (no production change, widest drift coverage); graft (a) behind it later. (d) rejected: RSS has committed subscribers - stated, recorded.

## Anti-patterns

- Three variants of one centroid - same mechanism wearing different names. You decorated; you did not fork.
- Skipping the gate because the task looks simple.
- Judging while generating, or the generator picking its own winner on a one-way door.
- Reaching for temperature or "be creative" phrasing - weak levers; axes and bans are the strong ones.
- A null candidate written as a strawman and dismissed unexamined.
- Narrating the methodology in the answer - jibber-jabber. The reader gets the comparison and the justification, not the ceremony that produced them.
