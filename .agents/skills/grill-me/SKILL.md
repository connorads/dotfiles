---
name: grill-me
description: Stress-test a plan, design, or architecture through relentless interviewing. Use when user says "grill me", "challenge this", "stress test my design", "review my plan", wants a design interview, or needs to think through decisions before building. Two modes — collaborative interview (default) and devil's advocate.
---

# Grill Me

Interview relentlessly about every aspect of this plan until we reach shared understanding. Walk down each branch of the design decision tree, resolving dependencies between decisions one by one.

**One question per turn.** Wait for the answer before moving on.

For factual or codebase questions, provide your recommended answer — the user reacts to it rather than generating from scratch. For design judgement calls, ask open questions without a recommendation to avoid anchoring bias.

If a question can be answered by exploring the codebase, explore the codebase instead of asking.

Stop when every branch of the decision tree is resolved.

## Devil's advocate mode

When the user says "challenge this" or "play devil's advocate":

- Argue against the design. Steel-man opposing viewpoints.
- Surface assumptions the user didn't know they had.
- Confront trade-offs being avoided.
- Propose radically different alternatives.
- Don't be agreeable — the value is in the pushback.
