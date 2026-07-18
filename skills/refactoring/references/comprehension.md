# Comprehension: understand before you change

First contact with an unfamiliar inherited system — the AI-vibe-coded variant
included, where the original author is gone and there was no handover. This
phase precedes the safety net: characterisation needs to know what to pin,
targeting needs to know what matters. Under uncertainty the instinct is to
read everything; that is the failure mode. Distilled from the
reverse-engineering half of Demeyer, Ducasse & Nierstrasz.

## Choosing a probe

| Question | Probe |
|---|---|
| Can this be rescued at all? | Time-boxed first contact → go/no-go ledger |
| What is the design? | Speculate, then check |
| What does this cryptic lump do? | Refactor to understand (throwaway) |
| Why is the design shaped this way? | Mine history for shrinkage |
| Where might it be wrong? | Hunt outliers, distrust thresholds |
| What is the domain model? | Recover it from the database |
| What was the intent? | Let users demo |

## Time-box first contact; produce a go/no-go, not a summary

Uncertainty tempts busywork — activity that feels productive while deferring
the real question of whether the system can be rescued at all. Invert it:
treat time as the scarcest resource, fix a short box (days, not weeks), and
spend it assessing feasibility, not achieving understanding. The deliverable
is a one-page ledger — opportunities (users still around, readable modules, a
live DB, tests that exist) and risks (no build, no tests, a subsystem nobody
can explain), each rated likelihood × impact, with an explicit go/no-go — not
prose about how the code works. Comprehension deepens later, only on the
parts the ledger says matter.

Two bounded probes earn their box on day one:

- **Read for vocabulary, not comprehension.** One timed pass over the whole
  codebase (the FAMOOS one-hour read scales at ~10k LOC/hour) with a prepared
  checklist, notes kept sparse. The output is not understanding but a map:
  the domain terms the code uses, its naming conventions, a shortlist of
  suspicious entities, a feasibility read. Force brevity — intensive reading
  only works in short bursts.
- **Can you even build and run it?** Reproduce build + boot in a clean
  environment, boxed to a day, logging every version, patch, and hidden
  dependency you have to discover — the log *is* the deliverable, not a green
  build. For an app with no handover this is the first risk to retire; record
  what blocks and move on rather than rabbit-holing the fix.

## Speculate, then check — top-down beats bottom-up at scale

Do not extract a model bottom-up (parse everything, then denoise): past ~100
types it drowns you in white noise and fixes attention on the irrelevant. Use
Murphy's reflexion model instead — write the class/module diagram you
*expect* from domain knowledge first, then grep its names against the source
and record every hit and every miss. The mismatches are the point: a name
that isn't there, or a concept modelled differently than you guessed, is
where understanding starts, so treat contradicting evidence as worth more
than confirming evidence. Iterate the guess until it stabilises. Names in
code lie — rank guesses by likelihood and try synonyms before abandoning a
hypothesis.

## Refactor to understand — throwaway, discarded by default

When a lump of code is cryptic, do not read it passively — restructure it to
force the design into the open. On a *scratch copy*, rename attributes,
methods, and classes to the roles you infer, and extract each conditional
leaf and each comment-delimited block into a named method, until the
structure states what it does. This is an experiment to test your reading,
not a cleanup: discard it by default, deciding afterwards whether any of it
is worth keeping under a proper net. Keep the result only where a
characterisation net already backs the code — otherwise you cannot know you
preserved behaviour.

## Mine history for shrinkage, not just churn

Churn × complexity (in the SKILL) finds where change concentrates; version
history answers a different question — *why* the design is shaped as it is.
Growth is mere feature accretion; the signal is where an entity **shrank** —
code removed, a class split, methods moved to a sibling — because that is
design consolidating, and recovering the refactoring recovers the reasoning
(Demeyer's shrinkage heuristic). Repeated grow-then-refactor in one place
marks a design still searching for its shape; growth then quiet marks a
matured one. Renames read as delete+add unless the VCS tracks them — allow
for that noise.

## Hunt outliers, distrust thresholds

Churn finds where to work; simple metrics find what might be *wrong*.
Measure the cheap things (lines, methods, fields, inheritance depth, fan-in)
and inspect the *outliers* — but do not filter by thresholds (you lose the
sense of what is normal here) and never fold several metrics into one score
(you lose the constituents that make an entity suspicious). Sort several raw
metrics per entity and scan the extremes. A caveat that bites doubly for
AI-generated code: an outlier is only a *candidate* — important code is often
unremarkable because it was cared for, while the exceptional entity is
sometimes just neglected and irrelevant. Confirm every hit by reading.

## Recover the domain from the database

Persistent data outlives the code that writes it and is often the most
coherent artefact in a vibe-coded system — start the domain model there. Map
tables to types and foreign keys to associations, but the schema alone is
too weak: inheritance hides in FK and column patterns (shared columns rolled
down, or one wide optional-column table rolled up), and domain constraints
exceed what the DDL declares. Verify every inferred relationship against
*data samples and the SQL the app actually runs*, not the schema in
isolation. Treat the store as an attic — presence is not value; much of it
is junk nobody deleted.

## Let users demo; interview while they drive

The author being gone does not mean intent is unrecoverable — the users hold
it. Do not send a questionnaire (you don't yet know what to ask) and do not
just ask what they like (they will list complaints). Watch a live demo and
interview *during* it: the working system gives them structure and a
positive frame, and your naive questions ("what did you just type?", "how do
you know that worked?") pull out knowledge no document holds. Different
roles surface different truths — end users show valued features, support
shows the pain, admins show the horror stories. With no user available, demo
the system to yourself: playing with the UI to generate naive questions is
itself a comprehension technique. What this recovers feeds the
requalification decision in [legacy-rescue.md](legacy-rescue.md) — which
behaviour deserves to survive.

## Cross-cutting habits

- **Static structure hides dynamic behaviour.** Source tells you what is
  defined, not what is instantiated or which concrete objects collaborate
  under polymorphism/DI. For a confusing flow, step it in a debugger — or,
  when interactive stepping isn't available, inject temporary tracing at the
  entry point and run the flow with varied inputs.
- **Tie questions to the code, not a wiki.** Record hypotheses and open
  questions as annotations *at the site* (a tagged comment / TODO), not in a
  separate understanding-doc that rots out of sync; resolve or delete each
  when answered.
- **Distrust docs, date them.** Compare each document's date against the
  system's; generated docs (schema dumps, API references) are fresh but too
  fine-grained; user manuals are the black-box truth of what's valued. Never
  decide from documentation alone — verify against code and running
  behaviour.

## Setting direction: fix the problem, not the reported symptom

Comprehension feeds one recurring decision per troubled component. Clients
keep breaking against a stable implementation → the fault is the interface;
wrap it and leave the guts. Largely defect-free but a bottleneck for change →
refactor to contain future change. Riddled with defects → rewrite the unit
and bridge its data across rather than patching. Ugly-but-stable-and-isolated
is not "broken" and earns no work — the SKILL's churn rule again. And prefer
the adequate simple option over the general flexible one: over-generalising a
system you don't yet understand usually guesses wrong and impedes the very
change you wanted.
