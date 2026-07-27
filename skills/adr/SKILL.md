---
name: adr
description: >-
  Writes and maintains architecture decision records (ADRs) for a decision that
  has already been taken, and reads existing records before touching what they
  govern. Use when asked to "write an ADR", "record this decision", "document
  why we chose X", "why did we do it this way", "supersede an ADR", "add this to
  docs/adr", or to write up a call after it was made - and when about to change
  a subsystem whose repo has an ADR directory. Not for reaching the decision:
  design-forking widens and compares the options, deciding-under-uncertainty
  commits to one as a calibrated bet, and architecture designs the target shape.
---

# Architecture Decision Records

One question governs every record:

> **Could a future reader recover why the losing option lost, without
> re-deriving it?**

That is the whole product. A record that names only the winner is a commit
message with extra headings.

## Write one only if you can name the loser and what killed it

The trigger test, both halves required:

1. name at least one option that actually lost, and
2. name the specific thing that killed it **here** - a mechanism, a measured
   number, a pinned version, a verbatim error, an upstream issue, an incident.

A reason that would read the same in any repo ("adds complexity", "less
idiomatic") fails the second half. No such reason means there was no decision -
put it in a code comment, then a subsystem `AGENTS.md`, then, only if it
constrains work beyond the file it lives in, an ADR.

Never manufacture losing options to fill the section. Asked to write records for
a list of choices, inventing plausible rejected alternatives and confident
reasons for them is the standing failure mode: it produces a record that is
fluent, unfalsifiable, and wrong about its own history. This binds hardest when
the invention is *good* - a named library nobody weighed, a reason cleanly
derived from the repo's other records. Derived is not observed. If you would be
supplying the reason, you are making the decision, not recording it: ask for the
killer, or say nothing lost.

**Not a decision record:** a conventional default with no live alternative (the
UI kit everyone reaches for, the directory a tool's own CLI writes to); a key
name, CSS value, or copy choice; an inventory of what was implemented; a pure
bugfix. **One decision per record** - the rename or index that rode along in the
same change is not part of it, and belongs in neither the title nor the body.

Given a list of "decisions" to write up, sort it first: say which items fail the
trigger test and why, write records for the ones that pass.

## Format

One required section, spelled exactly `## Alternatives considered`, with every
option carrying the reason it lost. Everything else is free - `## Context`,
`## Decision`, `## Consequences`, a known-limit note, a parked list - used when
each earns its place. Match what the repo's existing records already do.

- **No Status field and no `Proposed`.** A record on disk is in force; a record
  that is not decided yet is a draft, not a file. `Proposed` records rot in
  place and then get cited as policy.
- **Length is not the measure.** Seven honest lines beat four ceremonial
  sections. Prose carrying the decision beats headings around a decision that
  is not there.
- Timeless present: state the standing decision and its reasoning. Change
  history belongs in commit messages.
- British English; hyphens, not em dashes.

## Mechanics

- `NNNN-kebab-slug.md`, keeping the digit width the directory already uses.
- Next number is the max on disk **and** in
  `git log --all --diff-filter=A --name-only` - a withdrawn or reverted record
  still burns its number.
- The number is never repeated in the H1; the title states the decision, not
  its index.

## Supersession

A decision that changes earns a new record. In the superseded file, add exactly
one blockquote line under its H1:

```markdown
> Superseded by [0003](0003-write-plans-in-a-dedicated-do-namespace.md) - plans
> are stored per plan, not per session.
```

Nothing else in the old file changes. Never `## Update <date>`, never an inline
`**Amendment:**`, never a "this originally said" paragraph, and never edit the
old Decision so that it reads true again. The old record's job is to state what
was decided and why - including the assumption that turned out false, which is
usually the most instructive thing in the directory.

When only part of a record is superseded, the blockquote says which part, so the
rest is not read as retired.

## Before writing the file

The comparison gets checked before the record exists, not after. Reply with the
option list and the one line that killed each, and stop there - including when
the user already listed them, because what is being checked is your reading of
what lost, not their memory of it. A finished 60-line file gets skimmed; a
five-line comparison gets read, and it is the only defence against fluent
rationale for a comparison nobody ran.

Where nobody can answer - a background or otherwise non-interactive run - lead
the reply with the comparison and write the record in the same turn. That
escape covers the *review* only: an option whose killer you would have to
supply yourself stays a question, never a written record.

## Reading records

Before changing a subsystem, grep its ADR directory for the path, symbol, or
tool involved. Obey any "do not" line you find. Never ship a change that
contradicts a live record without superseding it in the same change - a record
the code silently contradicts is worse than no record.

`evals/` holds this skill's own test prompts and trigger queries; it is not
routed to during use.
