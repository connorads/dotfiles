---
name: distilling-domain-language
description: Choose or distil canonical domain language through structured interrogation. Use when naming a new domain concept, pinning down a project's ubiquitous language, when a term fights its own definition, several words compete for one concept, a glossary has bloated, or a hidden concept needs surfacing before terms are written into CONTEXT.md.
---

# Distilling Domain Language

The workshop, not the maintenance habit. Run an intensive interrogation to decide what a domain concept *should* be called - whether you are naming it for the first time or reopening a word the domain has outgrown - then hand the verdict to the `domain-modeling` skill to write into `CONTEXT.md`. That sibling owns the steady-state glossary and ADRs; **do not write `CONTEXT.md` yourself here.**

This is a grilling protocol: you drive it with named moves, one question at a time. But talk alone reaches false agreement - people nod at a word while meaning different things. So the instant a term resists, externalise the fight into a small forcing artifact (a scenario table, a hotspot register, a Given/When/Then). The artifact makes the contradiction impossible to hand-wave.

## When to run

- A new concept, feature or project needs its language chosen before names harden into code, schema and copy.
- A term fights its own definition ("a group invited together - but some are friends, not a household").
- Several words compete for one concept and nobody has decided.
- A glossary has bloated; terms feel loosely related.

The same moves serve both entry points: a brand-new coinage earns the exact grilling a disputed veteran does - it just starts with a clean sheet instead of a fight.

## Ground rules

- **One question at a time.** Wait for the answer before the next. Multiple at once is bewildering.
- **Always recommend an answer.** You are grilling, not surveying.
- **Explore before you ask.** If the codebase, `CONTEXT.md` or docs settle it, go look instead of asking.
- **Over-generate, then converge.** Diverge cheaply first - bad candidates cost nothing to discard. Being "too correct too soon" is the biggest mistake.
- **Provisional until proven.** Hold several candidate names in play at once. Expect churn. Never defend your first coinage.

## Worked thread

One example runs through this skill. A wedding glossary defines **Household** as "a group of guests invited and responding together" - but some parties are four friends, not a household. The word fights itself. The moves below drive it to a resolution: **Invitation**, the neutral superset the couple actually speak ("who's on the invite"), with `household`, `party` and `family` recorded as rejected.

## Session arc

Run the phases in order. Refuse to settle a noun before the process around it exists.

### 1. Diverge - surface raw material

- **Event walk.** When the user opens with a noun or a data model, refuse to model it. "Before we name anything: walk me through what actually happens, step by step, each step as a past-tense event - an invitation was sent, a reply was submitted." The contested noun must earn its place as the thing a command acts on. *(Household surfaces only as "the group that redeems one code and submits one reply" - a lead, not yet a name.)*
- **Candidate dump.** "Give me every word you, a guest, or the code uses for this - synonyms, the wrong-sounding ones, all of them." No judging yet. Grep the repo and `CONTEXT.md` for the synonym cluster first.

### 2. Interrogate - the grilling

Aim these at the surviving candidates, whether contested veterans or fresh coinages. Run one, react to the answer, then pick the next.

- **Say it out loud.** Put each candidate into 3-5 sentences someone would actually speak ("This ___ has responded"; "One ___ replied for four people"). Ask which sounds least forced. Awkward phrasing is audible faster than any diagram shows it, and awkwardness means wrong model, not just wrong word.
- **Scenario ambush.** Throw concrete, *named* edge cases at the definition: the Smith family of five; Connor's four uni friends sharing one reply; a couple at two addresses. "Does the definition still hold for each?" A case it silently excludes is the evidence. *(If the ambush stalls, or the user keeps patching the definition, escalate to the scenario matrix below.)*
- **Friction hunt.** Any definition carrying "but some are…", "or sometimes…", an exception clause, is a false cognate - one word doing two jobs. Ask "which part needs the most 'except when…' clauses?" That friction is a missing concept; hunt the word that dissolves it, never patch it with a caveat.
- **"It's just like X".** When the user leans on an analogy ("a household is basically a party"), pounce: "So what makes it *different* from X?" Every difference is a distinction the shared word would erase.
- **Who probe.** When a step is stated passively, "Who does this, and do they have sole authority?" Plural or uncertain actors expose a hidden concept.
- **Name the vague noun.** When copy leans on an umbrella noun (parties, items, guests, data), "Who or what exactly? Enumerate them." Each member becomes its own term or reveals a relationship.

#### Scenario matrix (escalation)

When verbal ambush isn't forcing the issue, lay the named instances against the surviving candidates as a table. A cell reading "no" or "strained" makes the false cognate a visible verdict, not something the agent must hear.

| Instance | Household? | Invitation? |
|----------|-----------|-------------|
| Smith family of five | yes | yes |
| Four uni friends, one reply | **no** | yes |
| Couple at two addresses | strained | yes |

The candidate that survives every row is the canonical term. If *every* candidate fails some row, the word is hiding two concepts - go to fork-or-unify.

### 3. Converge - crown the term

- **Fork or unify.** Once a word is proven overloaded, decide explicitly - don't drift: (a) **keep the name** but declare separate contexts if each meaning is internally coherent and context-scoped; (b) **fork** into two sibling terms plus the discriminator that tells them apart; (c) **rename to a neutral superset** whose definition survives every real case. Warn against "just make it a flag/folder" - that hides the mismatch, it doesn't fix it.
- **Domain-native check.** If the surviving candidate is borrowed from tech or generic vocabulary (User, Tenant, Household), "When two guests talk about being invited together, what do they actually call it?" Adopt the spoken word.
- **Three-way sort.** For a bloated glossary, walk each term and force a one-line verdict tied to the domain's purpose: **core** (keep - the language of this context), **foreign** (real, but belongs to another context or subdomain - hand it off), or **deferred** (real but out of scope now). Survivors are the language.
- **Given/When/Then lock.** When a term feels settled, restate the winning scenario as Given/When/Then using the canonical word **verbatim in every clause**. If a clause needs a synonym or a caveat, the language still has a gap - reopen the relevant move.

  ```text
  Given an Invitation holding a valid code
  When the holder submits the reply
  Then every Guest in that Invitation is locked to their chosen Attendance
  ```

- **Single-term convergence.** If several spellings or synonyms still survive, pick exactly one canonical word and list the rest as rejected *with the reason each lost*. One concept, one word, everywhere.

**Diagrams sparingly:** when sub-cases overlap, a quick ASCII/mermaid set sketch (subset / overlap) can make a split visible. A minor aid - the interrogation and the matrix are the work.

## Hotspot register

Thread a visible two-state list through every phase. The instant a term fights itself or two people mean different things, log it with a one-line *why* and a pointer to the move that will resolve it. Never smooth it over; resolve or consciously park each before declaring a term canonical.

```text
[open]     "Household" excludes friend groups replying as one party  -> scenario matrix
[resolved] plus-one with no name yet - is it a Guest?  -> yes, Placeholder slot
```

## Close-out and handoff

Distillation is multi-session - sleeping on it surfaces missing concepts. End every session with:

1. **Settled** canonical terms, each with its rejected candidates and why they lost.
2. **Open hotspots** still unresolved.
3. **Parked debt** - decisions deferred, with a note to resume.

Then hand each settled term to the **`domain-modeling`** skill to write into `CONTEXT.md`: the term, a tight definition (what it *is*, not what it does), and the rejected words under the `_Avoid_` slot in that skill's `CONTEXT-FORMAT.md`. If a genuine boundary emerged (one word, two coherent context-scoped meanings), that is a `CONTEXT-MAP.md` split - `domain-modeling` owns it, and opens an ADR if the resolution was a hard-to-reverse, surprising trade-off. Keep implementation detail out; `CONTEXT.md` is a glossary and nothing else.
