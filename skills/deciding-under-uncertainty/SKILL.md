---
name: deciding-under-uncertainty
description: >-
  Hardens a recommendation on a consequential, hard-to-reverse call into a
  calibrated bet with a pre-agreed exit, instead of a single confident
  verdict. Use when advising or deciding: build vs buy, adopt or swap a
  dependency or platform, migrate now or wait, rewrite vs refactor, quit or
  double down, ship or delay - any "should we / should I" where being wrong
  is expensive to undo. Also for judging a past decision fairly. Not for
  generating design alternatives - the design-forking skill owns widening the
  option set; this skill disciplines the commitment once a leading option
  exists.
---

# Deciding Under Uncertainty

The failure this fixes: asked a consequential "should we?", an agent
researches well, then lands the answer as a verdict - "My call: X. That's a
weekend." Confident, plausible, and missing everything that makes a decision
defensible or cheap to exit: no odds, no reference class, no failure
rehearsal, no pre-agreed way out. Advice on a hard-to-reverse call is a
**bet**; deliver it with a bet's machinery.

The classic checks (sunk cost, pros/cons, the successor test) need no help -
don't pad the answer with them. The five moves below are the ones
consistently skipped.

## 0 - Gate

Same doors as design-forking. Cheap to reverse: answer plainly, note the
reversal path in one line, stop - odds and tripwires on a two-way door are
ceremony. Hard to reverse with only one option on the table: widen the set
first (design-forking owns that), then return here to commit to the winner.

## The five moves

**1 - Reference class before inside view.** Name the class this decision
belongs to and how it usually goes - "solo-dev auth hand-rolls", "big-bang
rewrites of untested code", "CI speed migrations" - before reasoning about
this instance's specifics. The inside view is where motivated reasoning
lives; the base rate anchors it. One or two sentences; a named class with a
typical outcome beats a statistic you would have to invent.

**2 - Odds, not a verdict.** State the recommendation with a calibrated
probability - "roughly 75% this still looks right in six months" - plus the
one observation that would most move the number. A percentage without a
mover is decoration; the mover is what makes the number falsifiable.

**3 - Premortem, not a risk list.** Assume the recommendation was taken and
failed: write the single most likely post-mortem sentence. "We took the
library route and ripped it out six months later because ..." A list of
generic risks is inside-view hedging; the premortem forces one concrete
causal story - and that story usually names the assumption to probe (move 5)
and the tripwire to set (move 4).

**4 - Tripwires that outlive the conversation.** Pre-agree the exit: an
observable predicate + a checkpoint + the action. "If the pilot hasn't cut
CI install below 2 minutes by end of sprint, stay put" - not "revisit later"
or "reconsider if problems arise". Then write the tripwires where the
project keeps decisions (ADR, tracking issue, an AGENTS.md note): a tripwire
that exists only in the chat dies with the session, and without the record
the decision will later be judged by its outcome alone.

**5 - Ooch before the bet.** Propose the smallest reversible probe that
tests the premortem's assumption - a timeboxed spike, one route migrated,
one package piloted - and say what result would flip the call. Skip it, and
say so, when the probe costs more than being wrong or when delay itself is
the biggest cost.

## Deliver as advice, not a filled-in template

The moves are scaffolding; the reader gets their fruits woven into normal
advice, never a five-heading ceremony. Lead with the recommendation and its
odds; the reference class is a clause; the premortem is "the way this goes
wrong is ..."; the tripwires are a short "revisit if" block at the end. No
skill vocabulary (ooch, premortem, reference class) in the answer.
Proportion the machinery to the stakes: a platform migration earns the full
set; a mid-sized call may earn odds and one tripwire.

## Judging past decisions

Grade the decision, not the outcome: what was known at the time, and was the
process sound - real alternatives, stated odds, an exit? A good bet can
lose; a bad bet can win. "Bad outcome, right call given what was known" is a
legitimate verdict, and recorded tripwires (move 4) are what make it
reachable later.

## Worked example (compressed)

"Monorepo pnpm installs feel slow in CI - migrate to bun?"

- Gate: whole-repo package-manager swap - expensive to undo. Full set.
- Reference class: CI install complaints are usually cache misses, not
  resolver speed; most such migrations buy less than warming the cache.
- Odds: ~80% that store caching makes the migration moot; drops sharply if a
  warm-store install is still the bottleneck.
- Premortem: "we migrated, then hit workspace and lifecycle semantics that
  differ at monorepo scale, and lost install-gating we relied on".
- Tripwire (recorded on the tracking issue): warm-store CI install still
  over 2 minutes after caching lands this sprint -> run the bun pilot;
  otherwise close.
- Ooch: cache the store keyed on the lockfile hash this week - cheapest
  probe, tests the reference-class hunch directly.

Delivered: "Wait - fix caching first. Slow CI installs are nearly always
cache misses rather than the package manager, so I'd put ~80% on caching
making this moot. Revisit if a warm install still tops 2 minutes after this
sprint - I've noted that on the issue - and if it does, pilot bun in one
package before touching the monorepo."

## Anti-patterns

- A percentage as decoration - "80% confident" with nothing named that
  would move it.
- A risk list wearing a premortem's clothes - five hedges instead of one
  causal failure story.
- "Revisit later" - a tripwire missing its predicate, checkpoint, action,
  or a home outside the chat.
- Hedging both ways to dodge the odds - the deliverable is still a
  recommendation; the machinery makes it defensible, not optional.
- Running the full set on a two-way door - ceremony that teaches the user
  to stop asking.
- Narrating the moves in the answer.

<!-- evals/ holds this skill's trigger + behaviour test prompts; run when revising. -->
