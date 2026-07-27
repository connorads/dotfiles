# Architecture Decision Records

Repo-level ADRs for these dotfiles: decisions with real trade-offs, where a future
reader would otherwise have to re-derive why the obvious alternative was not taken.

Subprojects keep their own ADR dirs (e.g. [`../../.config/skl/docs/adr/`](../../.config/skl/docs/adr/)).
This dir is for decisions that span the dotfiles themselves - shell glue, nix
modules, hooks, the test harness.

## When to write one

Write an ADR when a decision:

- has more than one defensible answer, and the losing options are not obviously bad;
- constrains future work (a rule others must follow, a shape others must copy);
- was expensive to reach, so re-deriving it would waste the next reader's time.

Do not write one for a choice with a conventional default, or one a comment in the
code can carry. Prefer a comment, then a subsystem `AGENTS.md`, then an ADR.

## Format

File name: `NNNN-slug.md`, sequential. Scan this dir for the highest number and
increment. Numbers are never reused, and an ADR is never deleted - a decision that
gets reversed earns a new ADR that says so.

Start with an H1 title and a short paragraph of the decision in plain terms, then
these **four required sections**:

| Section               | Holds                                                    |
| --------------------- | -------------------------------------------------------- |
| `## Context`          | the problem, the constraints, what forced a decision      |
| `## Decision`         | what we chose, in the present tense                       |
| `## Considered Options` | **every alternative weighed, each with why it lost**    |
| `## Consequences`     | what this costs, what it forecloses, what to watch        |

Optional `### Parked` for follow-ups that were deliberately deferred, so a reader
can tell "not done yet" from "decided against".

Write timelessly, in the present tense: an ADR states the standing decision and the
reasoning behind it. Change history ("we used to...", "this replaced...") belongs in
commit messages.

### Divergence from the `domain-modeling` skill's ADR-FORMAT

The vendored
[`ADR-FORMAT.md`](../../.config/skills/vendor/.agents/skills/domain-modeling/ADR-FORMAT.md)
lists **Considered Options** and **Consequences** as optional. Here they are
required.

The reason is specific: an ADR whose rejected alternatives were not recorded is
exactly the failure that motivated this dir. A proposal arrived naming a direction
but not why the others lost, so the whole comparison had to be redone from scratch.
Recording the losers is most of an ADR's value; recording only the winner is a
commit message.

This is a deliberate local rule, not drift. All nine existing
[`.config/skl/docs/adr/`](../../.config/skl/docs/adr/) ADRs already use all four
sections, so it codifies practice rather than inventing it.
