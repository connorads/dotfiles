---
name: living-documentation
description: >
  Write durable, trustworthy documentation that does not rot - for AI agents
  (AGENTS.md/CLAUDE.md, skills) and humans (ADRs, READMEs, knowledge bases).
  Distilled from Cyrille Martraire's "Living Documentation". Use when authoring
  or reviewing an AGENTS.md/CLAUDE.md, writing a skill, writing an ADR or doc,
  deciding whether something is worth documenting, or when docs keep going
  stale. Triggers: "living documentation", "is this doc trustworthy", "should
  this be documented", "why does this doc keep going stale", "doc rot".
---

# Living Documentation

Knowledge sharing that stays correct with the least effort. Distilled from
Cyrille Martraire, *Living Documentation: Continuous Knowledge Sharing by
Design* (Addison-Wesley, 2019) - cite the book as the canonical source.

The whole method hangs off one maxim: **no mechanism, no trust.** A durable fact
without something keeping it true is rot-in-waiting, and one stale fact a reader
catches destroys the authority of every other fact in the document.

## Use when

- Writing or reviewing an `AGENTS.md` / `CLAUDE.md`, a `SKILL.md`, an ADR, a
  README, or a knowledge-base note.
- Deciding whether a thing is even worth documenting.
- A doc keeps drifting from reality, or feels too long to trust.
- Designing how a project's knowledge should be organised.

## The codex (sticky maxims)

Lead with these; they are meant to be memorable, not nuanced. Depth is in the
references.

1. **No mechanism, no trust** - every durable fact needs an accuracy check, or it is rot-in-waiting.
2. **Document only the delta from defaults** - say only what a competent reader does not already know.
3. **Rule of Two** - write the rule the *second* time you correct someone, never speculatively.
4. **Code shows what and how; documentation exists for *why*.**
5. **The best documentation never has to be read** - it fires at the right moment, or makes the wrong thing impossible.
6. **Put knowledge on the thing it describes** - so it moves, renames, and dies with that thing.
7. **Date it and let it be** - accounts from the past need no upkeep; only current-state docs do.
8. **Reference volatile -> stable, never the reverse** - churn must not cascade upward.
9. **One document, one message.**
10. **If it is hard to document, fix the design, not the prose.**
11. **Link, don't re-explain** - name the canonical source and write only your 1%.
12. **Derive it; never store the derived thing as a source.**

## The eight themes (map)

Each maps to a section of [references/principles.md](references/principles.md)
(the general method) and [references/agent-docs.md](references/agent-docs.md)
(applied to AGENTS.md / skills / ADRs / KBs).

1. **Accuracy & trust** - pair every fact with a mechanism; the hierarchy of accuracy; dated accounts need none.
2. **What earns a place** - the default is *don't*; salience, Rule of Two, sedimentation, link-don't-re-explain, biodegradable docs.
3. **Where knowledge lives** - co-location, evergreen vs volatile, volatile->stable references, perennial naming.
4. **Rationale & decisions** - record the why and the rejected alternatives; commit messages as docs; the architecture codex.
5. **Enforcement over prose** - turn rules into types/linters/tests/hooks; the config *is* the doc.
6. **Curation & navigation** - one message per doc; highlight the core; sightseeing maps; make it skimmable and searchable.
7. **Generated / living artifacts** - consolidate dispersed facts; living glossary; exploit knowledge already in tools.
8. **Feedback loops** - docs as a design mirror; the cold-newcomer astonishment report; the two-minute test.

## How to use this skill

- **Authoring / reviewing a doc?** Run the relevant checks from
  [references/rituals.md](references/rituals.md): the salience pass, the
  two-minute test, evergreen/volatile classification, and (for any
  hand-maintained fact) "name the mechanism that keeps this true".
- **Doc keeps rotting?** Reach for theme 1 + 5 + 7: add a reconciliation check,
  enforce the rule instead of stating it, or derive the fact from its source.
- **Deciding what to capture?** Apply theme 2: Rule of Two, sedimentation, and
  the three gates (long-lived? many readers? critical?).

## Don't duplicate sibling skills

Per maxim 11, point at these rather than restating them:

- **mechanical-enforcement** - which rules to turn into linters/hooks and how (theme 5).
- **architecture** - domain modelling, ports/adapters, making illegal states unrepresentable (theme 5.3).
- **testing** / **test-coverage** - reconciliation tests, contract tests, enforcement gates (themes 1, 5).
- **hk** - wiring pre-commit hooks and local checks for the mechanisms above.
