---
name: agent-ergonomics
description: >-
  Re-design an existing project plan around the agent that will drive it, so the
  system is intuitive, ergonomic and accretive to an agent rather than a set of
  parts. Use once a plan or design docs exist and before implementation starts,
  when the target is a system an agent will operate over many sessions. Rewrites
  the design documents; it is not a review pass.
disable-model-invocation: true
---

# Agent ergonomics

A planning pass that asks the model to re-derive the design from the point of
view of the agent that will operate it. Run it on a plan that already exists.

## The prompt

Paste this verbatim as the follow-up message. Its length and its insistence are
the mechanism; paraphrasing it shortens the deliberation it asks for.

```text
OK, now I want you to think deeply about how to make this entire system as
agent-intuitive, agent-ergonomic, and agent-accretive as you can possibly
imagine. Put yourself in the driver's seat and imagine that YOU are the one
using this system and driving it. What would most enable you to do an awesome
job understanding the situation accurately and optimally controlling everything
to drive the best and most accurate results possible, with the least
expenditure of resources?

Then make all the requisite changes to the various design documents and plans
accordingly. Don't just think of the project as an assemblage of various parts
or components: really try to profoundly and deeply conceptualize it as a
synthetic SYSTEM that is maximally coherent, cohesive, modular, and
interconnected, forming a tower of linked abstractions that are maximally
legible to you as an agent. Really ruminate and meditate on all of this
incredibly deeply before responding or taking any actions.
```

## Using it

**Precondition: a plan exists.** The prompt edits design documents. With nothing
to edit it produces generic advice.

**The output is a rewrite, not a critique.** Expect the plan's structure to
change: interfaces collapsed into fewer, a state surface the agent can read in
one call, conventions that make the next component's shape predictable from the
last. If it comes back as a list of suggestions, the design docs were not named
concretely enough - say which files to edit.

**Run it once, then review by hand.** It is a divergence step. A second pass on
an already-reworked plan tends to add abstraction the project does not need.

**Cost is the point of the last clause.** "Least expenditure of resources" is
what stops the rewrite inflating into ceremony; keep it in.

## Provenance

From a tweet by Jeffrey Emanuel (`@doodlestein`),
`x.com/doodlestein/status/2094288037458882668`. The claim attached to it is that
frontier models do not apply this framing unless asked.
