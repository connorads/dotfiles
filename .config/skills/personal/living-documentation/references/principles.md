# Principles - the general method

The eight themes, medium-agnostic. Each principle: its essence and the
mechanism that makes it real. Applied versions (AGENTS.md / skills / ADRs / KBs)
live in [agent-docs.md](agent-docs.md); runnable recipes in
[rituals.md](rituals.md).

---

## Theme 1 - Accuracy & trust

> Maxim: *No mechanism, no trust.*

Documentation is useful only if it can be trusted. Humans are unreliable
maintainers, so trust must come from a mechanism, not from diligence. Once a
reader catches one misleading fact, the whole document loses credibility and all
the effort that went into it is wasted.

- **Pair every durable fact with an accuracy mechanism.** For each non-obvious
  claim, name what keeps it true: a single source, automated propagation, or a
  reconciliation test. If you cannot name one, treat the fact as rot-in-waiting.
- **The hierarchy of accuracy.** In order of preference: (1) one authoritative
  source; (2) duplicate but auto-propagate; (3) duplicate but auto-detect drift;
  (4) "someone will remember" - which is no mechanism at all.
- **Single-source publishing.** Keep each fact in exactly one place; derive every
  other view automatically. Treat prose like code: DRY, includes, generation.
  Derived copies are never hand-edited.
- **Accounts from the past need no accuracy mechanism.** A dated, clearly
  historical record (a commit, an ADR, a journal entry) promises accuracy only
  *as of its timestamp*. It is never "obsolete". Trying to keep a dated note
  evergreen is a category error - separate episodic records sharply from
  current-state reference.

---

## Theme 2 - What earns a place

> Maxim: *The default is: don't.*

Most knowledge matters only at the moment it is created. Durable form is a cost
(it must be found, read, and kept true), so make things earn it.

- **Salience - tell only the differences and the unknown.** Describe the specific
  by contrast with the well-known. List the 5-7 distinctive points versus the
  generic baseline; never document standard practice or how a well-known tool
  works. This keeps a document dense with non-recoverable knowledge.
- **Rule of Two / just-in-time.** Let a real, repeated need pull a doc into
  existence. When the same question or correction recurs (the second time),
  write it down - and capture the answer at the moment you give it.
- **Idea sedimentation.** Favour cheap exchange first; let ideas settle; promote
  only the survivors. Three gates for durability: long-lived? many readers?
  critical? Transient "how I fixed it" belongs in a commit message, not a
  reference doc.
- **Link, don't re-explain (ready-made documentation).** If knowledge already
  exists authoritatively, name the pattern precisely and link it; write only the
  project-specific 1%. Your paraphrase is less accurate than the link, and a
  correct pattern name carries all its implied constraints for free.
- **Throwaway / biodegradable documentation.** A doc describing a temporary state
  must disappear with that state, or it becomes a lie. Anchor the note to the
  artefact being removed (tag the thing being strangled, not the survivor) so it
  self-cleans. Mark disposable docs as disposable, and actually delete them.

---

## Theme 3 - Where knowledge lives (proximity & stability)

> Maxim: *Put knowledge on the thing it describes.*

- **Co-located / internal documentation.** The best place for knowledge about a
  thing is *on the thing*, in the implementation technology - annotations,
  naming, an adjacent file. It then moves, renames, and dies with the code, and
  refactoring tools carry it for free.
- **Evergreen vs volatile separation.** Plain prose is safe only for knowledge
  that stays true for years. Classify before writing: stable -> evergreen prose;
  volatile -> generate from code/config/tooling. Never interleave the two in one
  file, or the whole file needs upkeep.
- **Volatile-to-stable reference direction.** References must point from
  more-volatile to more-stable, never the reverse, so churn does not cascade.
  Implementation -> contract, artefacts -> goals, goals -> vision.
- **Perennial naming + stable axes.** Business/purpose names outlive
  tool/brand/project names and are themselves documentation. Name sections and
  modules by durable purpose ("supply-chain hardening"), not the current tool
  ("aube config"). Partition along the slowest-changing dimension.
- **Stable links: convention/search over paths.** Hardcoded paths and URLs rot on
  the first refactor; a search over a naming convention survives moves. Reference
  by glob/regex or a grep recipe; add a broken-link checker; route shared
  external links through one registry.

---

## Theme 4 - Rationale & decisions

> Maxim: *Code shows what and how, never why.*

The rationale and the discarded options are the most valuable durable knowledge,
because they are unrecoverable from the code.

- **Record the why - context, problem, decision, rejected alternatives.** Per
  decision: the context and assumptions, the *problem* (stated before the
  solution), the decision and its reason, and the serious alternatives with
  why-not. Mark which assumptions the decision depends on. Use an ADR for
  system-wide decisions; an annotation or commit message for local ones.
- **A deliberate decision is half-documented (and a design-smell detector).** You
  cannot document a *random* decision - it is just noise. If you cannot name two
  or three credible alternatives, the choice probably was not deliberate. "First
  fit, to ship fast" is a valid recorded reason *if it was conscious*.
- **Commit messages as documentation.** Project history is the richest doc; every
  line's rationale is one `git blame` away. Use a semi-formal convention
  (`type(scope): subject` + body + footer) with an agreed scope vocabulary.
- **Architecture codex / maxims.** The tacit heuristics seniors use should be
  explicit: short, opinionated one-liners, each ideally with a one-line example;
  never finished; contradictions resolved as they surface. For the few
  load-bearing rules everyone must always hold, coin terse, sticky maxims and
  repeat them. Stickiness beats nuance for things that must be retained.

---

## Theme 5 - Enforcement over prose

> Maxim: *The best documentation never has to be read.*

The highest-leverage move: make the rule fire automatically, or make the wrong
thing impossible. The tool's configuration then *is* the reference - so do not
also duplicate it in prose.

- **Turn rules into types, linters, tests, hooks.** A rule a reviewer must
  remember is effective only when enforced. A named, declarative rule both
  documents and protects the decision. (See the **mechanical-enforcement** skill
  for which rules to mechanise and how.)
- **Constrained behaviour / make the right thing easy.** Shape the environment so
  the path of least resistance is the correct one: good defaults, scaffolding,
  wrappers, wizards with inline help. The environment then carries the knowledge
  implicitly - "why document in text what could be a tool?"
- **Error-proof / types over comments.** Comments and names can lie; types
  cannot. Promote primitives to named/branded types, validate in constructors,
  parse-don't-validate, make illegal states unrepresentable. (See the
  **architecture** and **typescript** skills.)
- **Reconciliation / broken-link tests.** Direct links and hardcoded references
  silently rot; detect it before a reader does. A broken-link checker over docs,
  and a low-tech test asserting a doc's literal still matches reality, are the
  most actionable single additions you can make.

---

## Theme 6 - Curation & navigation

> Maxim: *One document, one message.*

Available is not the same as useful. Optimise for a reader (or agent) landing
cold: high signal, scannable, findable.

- **Stigmergy - markers guide the next action.** Contributors extend prior work
  by reading markers left in the environment. Leave high-signal markers: callable
  command names, a pointer to the right place, a clear next-step cue. A good
  instruction file is a field of stigmergic markers.
- **Highlight the core + inspiring exemplars.** Flag the small subset that
  matters; point at the best real example as "do it like this". People (and
  agents) imitate the nearest example - make the nearest one the best one.
- **One message at a time.** Each document/diagram/section delivers exactly one
  clear, verb-bearing message; filter to 5-9 items. Decide the single editorial
  focus first, then cut aggressively. Noise in one view is signal in another -
  make separate views rather than one crowded one.
- **Guided tour + sightseeing map.** Help a cold reader follow one end-to-end
  path, or hit 5-7 points of interest, rather than reverse-engineering. Add an
  ordered tour only where the flow is genuinely non-standard.
- **Search-friendly, skimmable, fidelity-signalled.** Use distinctive, greppable
  terms and synonyms; informative headings; and mark provisional guidance *as*
  provisional so it is weighted correctly.

---

## Theme 7 - Generated / living artifacts

> Maxim: *Derive it; never store the derived thing as a source.*

- **Consolidate dispersed facts automatically.** When truth is scattered across
  many files, scan-and-aggregate into one derived view rather than
  hand-summarising. Think `GROUP BY`: scan the perimeter, build the view,
  republish on each build. Cache only for speed; it must always be rebuildable.
- **Living glossary / ubiquitous language from code.** Extract the glossary *from*
  identifiers that follow the domain language, so it cannot drift. A
  glossary that reads badly is feedback that the naming is wrong - fix it at the
  source.
- **Exploit knowledge already in your tools.** Version control, package
  registries, CI, build tools and service CLIs already hold authoritative state.
  Pick the single authoritative tool per fact and query it, rather than copying
  the fact into prose that `--help` already answers.
- **Living diagrams as code.** Generated-from-source, plain-text diagrams (Mermaid
  / Graphviz / PlantUML) committed to the repo diff cleanly, survive renames, and
  cannot silently lie the way a hand-drawn binary does. One diagram, one story.

---

## Theme 8 - Feedback loops (docs as a design mirror)

> Maxim: *If it is hard to document, fix the design, not the prose.*

- **Astonishment report via a cold newcomer.** A newcomer's fresh confusion is the
  best signal of what is missing or wrong, and candour decays as they
  acclimatise. Have a newcomer record every surprise in their first hours; each
  surprise is a precise pointer to a doc gap. (For agent docs this is nearly free
  - see [rituals.md](rituals.md).)
- **Listening to the documentation / shameful documentation.** Difficulty or
  embarrassment in documenting is a design signal. A long "gotchas" list is
  partly a confession of friction. Treat the urge to document a workaround as a
  trigger to fix the root cause; a hard-to-generate glossary means muddled
  naming. (Genuinely unfixable, upstream constraints are the legitimate
  exception - record those.)
- **Brevity / the two-minute test.** What cannot be explained quickly will not be
  understood. If you can explain the thing aloud in under two minutes, write it
  down; if not, simplify the thing first.
- **Documentation-driven (README-first).** Writing the doc first, like writing a
  test, forces clarity of intent and surfaces inconsistency before expensive work
  exists. Draft the intent as if already done, then build to it.
- **Don't over-invest in doc tooling.** Generating docs is a means, not an end.
  The real goal is quality and standardisation that make the doc unnecessary.
  Ask of every entry: "what would make this unnecessary?" Prefer widespread
  conventions so newcomers need no custom explanation.
