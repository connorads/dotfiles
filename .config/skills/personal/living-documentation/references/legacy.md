# Rescuing an inherited / legacy system

The case the general method assumes away: a system nobody understands - an
inherited or AI-vibe-coded codebase whose author is gone, specs lost,
knowledge *fossilised* in code too obscure to read. Distilled from Martraire
ch. 14 (+ 11-12). Every other reference still applies; this file adds the
legacy-specific moves. This is the documentation side of a rescue - the
`refactoring` skill (public catalogue) owns comprehending, characterising,
and migrating the code itself.

| Situation | Reach for |
|---|---|
| No spec, but the app still runs | Fossilised knowledge - instrument it |
| You can't read the structure | Superimposed + highlighted structure |
| The code is too fragile to touch | External annotation registry |
| Too big to hold in your head | Small-scale simulation; comprehension diagnostics |
| Building new work amid the mess | Bubble context |
| Protecting a migration decision | Enforced legacy rules; bankruptcy |
| Many hands over a long migration | Agreed maxims |

## The running system is documentation (fossilised knowledge)

An app with lost specs is still an oracle: it answers "how does it behave?"
by running it, and "how often is this feature used?" once you instrument it.
Mine it - but never treat it as the spec for a rewrite. The "rewrite with the
same specs" trap is pure risk for no gain: recover behaviour into concrete
scenarios with a domain expert present, and challenge every feature's right
to exist. The mechanics of instrumenting and requalifying live in the
`refactoring` skill's legacy-rescue reference - link there; this file owns
what you *write down* from what the oracle reveals.

## Archaeology - Feathers' effect map

Keep pen and paper at the keyboard. As you read, run, and step through the
code, note each responsibility's inputs, outputs, and - crucially - what it
**reads and writes** (side effects are what actually bind change). Sketch how
each responsibility leans on its neighbours: Feathers' effect map. Keep it
low-tech and task-scoped; when done, sediment only the one or two findings
general enough to help the next task into a clean note. (Effect reasoning as
*test placement* is the `refactoring` skill's ground - this is the
note-taking side.) Old devs, dead wiki pages, and stale slides are all
partly-wrong sources - triangulate them.

## Superimposed structure - invent the structure it should have had

An incomprehensible system has no structure you can lift from it, so invent
one: project a clean model *onto* the mess - deliberately a structure it was
never built with - and document it as shared language even though nothing in
the code exhibits it. Reasoning through a better structure yields better
decisions while the code stays ugly. Useful projections: **business
pipeline** (stages of the user journey; volume drops per stage, which
informs scaling); **asset capture (Fowler)** - the two or three core assets
(customer, product), each sliced into segments; **bounded contexts
(Evans)** - highest payoff, needs domain maturity; **levels of
responsibility** (operational / tactical / strategic). Once you have it,
the system becomes discussable ("rewrite the payment stage, downloads
first").

## Highlighted structure - pin the model onto the code

Make the invented structure greppable: tag each class/module with the
subdomain it belongs to (`@Billing`, `@Catalog`). A search now reveals the
business structure the folders hide, and it paves the way to physically move
tagged code together later. The end state is for the superimposed structure
to *become* the real one; you rarely finish, but the interim decisions are
already better.

## External annotation registry - when the code is too fragile to touch

Sometimes you must not touch the code - it barely builds, regressions are
one edit away, or you're forbidden. Keep augmentation *outside*: a sidecar
file mapping paths/packages to tags (`acme.core = DomainModel
FleetManagement`), parsed by your tooling exactly as inline annotations
would be. The cost: being external, it silently rots on a rename - add a
reconciliation check (theme 1) that every mapped path still exists.

## Bubble context - a clean island in the mess (Evans)

Do new work in its own fresh module with state-of-the-art standards enforced
from line one (high coverage, no imports of deprecated components, low
complexity), documented with the normal toolkit. A bubble context buys
greenfield comfort inside the legacy surround, and is the natural home for a
strangling replacement.

## Small-scale simulation - shrink the system until it fits your head

When the system is too nebulous to grasp, build a stripped-down *executable*
replica of only the one or two aspects that matter, purely to understand it;
recover lost design intent by watching it run. Simplify aggressively: curate
away features, stub middleware with in-memory collections, approximate
results, swap awkward types for convenient ones (dates -> integers),
brute-force over clever algorithms, flip batch <-> event. It fits in your
head, tinkers in a REPL, and grounds later conversations in real code.
Cockburn's walking skeleton and Hoover & Oshineye's breakable toys are the
same instinct.

## Comprehension diagnostics - cheap X-rays of an unknown codebase

- **Word cloud from identifiers** - treat the source as plain text, strip
  language keywords, count the rest. Technical words dominate -> the domain
  language isn't in the code (rescue lever: put it there). Domain words
  dominate -> the model is sound. A word cloud or a tangled dependency
  diagram also lets a non-developer *feel* the mess - use it to earn time
  for cleanup (hygienic transparency).
- **Cunningham's signature survey** - reduce each file to its punctuation
  only (`;{}"`), and the shape and size of the code jump out: a few huge
  classes vs many small ones, visible without reading a line.

## Architecture reality check

Generate the *implemented* architecture (dependency/living diagrams) and
diff it against the *intended* one; the gap is where erosion happened. For
legacy you often have no intended architecture - reverse-engineer it
gradually from the implemented one, then hold new work to it.

## Enforced legacy rules - protect the migration decision

A migration outlives the people running it, so automate the big decisions
rather than trusting docs to be read. Beyond static rules: enforce "never
call this method except from the sync listener" at *runtime* by inspecting
the call stack and failing (or logging) when the caller isn't whitelisted
(Igor Lovich). Freeze a component by revoking commit rights - the "why?"
that follows is the teaching moment. On a codebase already full of
violations you cannot fail closed: enforce only the few critical rules hard,
warn on the rest, or apply strict rules to new/changed lines only.

## Bankruptcy and biodegradable transformation

Migration docs must die with the migration. Tag the *dying* artefact, not
the survivor: `@StrangledBy("Butterfly")` on the strangled app self-cleans
when the app is deleted; a leftover `StranglerApplication` tag that never
gets removed is itself a signal the migration stalled. Declare a too-fragile
app *bankrupt* - a `BANKRUPTCY.txt` stating what not to do, plus revoked
commit rights - so nobody sinks effort into a system meant to disappear.

## Agree on maxims

A long migration needs many hands pulling the same way. Coin a few terse,
repeatable maxims and say them daily: "One work site at a time", "When in
Rome, do as the Romans do" (stay conservative in code you won't rewrite),
"Don't feed the monster" (improving the legacy only makes it live longer).
Make them rhyme; stickiness beats nuance (Object-Oriented Reengineering
Patterns).
