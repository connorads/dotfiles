# Legacy rescue

Taking over an inherited, untested codebase — including the AI-generated
variant. Assumes the SKILL.md spine (safety-net precondition, hotspot
targeting, Mikado, ratchets, deletion conditions); this file is the mechanics.
On an unfamiliar system — especially one with no handover — start with
[comprehension.md](comprehension.md), then return here to build the net.

## Characterisation: pin behaviour you don't understand

The legacy dilemma (Feathers): changing code safely needs tests, and adding
tests needs changing the code. The escape is the seam — a place where you can
alter behaviour without editing the code there, via its enabling point (a
constructor argument, a factory, an injected dependency). Prefer object seams
(substitute via polymorphism/injection); link-time and build-time seams hide
test/production divergence in configuration.

Writing the tests is mechanical: call the code, assert something you know is
wrong, and let the failure tell you the real output — pin that. Approval-test
tooling (Emily Bache's framing) does this at scale: capture output to a file,
diff on every run, re-approve deltas deliberately. Engineering effort goes
into the *printer* — turning state into a stable, diffable string. For
many-parameter legacy functions, combination approvals (every argument
combination into one snapshot) build a wide net fast.

Characterisation tests document what the system does, not what anyone wishes
it did. They are a refactoring net, not a correctness suite — the `testing`
skill covers when and how to grow real behavioural tests behind them.

To ship new behaviour before the surrounding code is safe to touch: sprout
(new tested unit, called from one point in the old code) or wrap (new method
or decorator with the old name, running the new step around the delegated
original). Both buy time without improving the old code — they are entry
points, not the cleanup, and overuse grows the untested core.

## Where to pin: reason forward to the funnel

Characterisation says pin behaviour; effect reasoning says where. When one
change touches several tangled methods, resist the reflex of one unit test
per class — that forces breaking dependencies on every collaborator. Reason
forward from each change point along the three channels effects travel —
return values a caller reads, mutation of passed-in objects, and writes to
static/global state — and find the pinch point (Feathers): the narrowest
method or two that all those effects funnel through. Write one covering test
there; it pins the whole cluster while you refactor beneath it. Narrow to
per-class tests once the area is safe, then delete the covering test.
Language firewalls bound the search — private fields, immutability, and
value semantics are effects you need not trace past — but package/protected
scope, references aliased and held after construction, and language escape
hatches defeat them, so confirm rather than assume. A pinch point is also a
natural encapsulation boundary: where effects funnel is often where a hidden
class wants extracting.

## Break dependencies safely before the net exists

The behavioural net is the precondition, but making code testable usually
needs edits before any test runs — the legacy dilemma in miniature. Make
those unprotected edits provably safe, not merely careful:

- Prefer the toolchain's behaviour-preserving refactorings (LSP/IDE rename,
  extract method, extract variable) over hand-editing via search-replace; a
  tool that refuses an unsafe move is a stronger net than review. When you
  must go by hand, keep tool-driven and manual edits in separate commits,
  and change one thing at a time — park every tangent that surfaces mid-edit
  rather than chasing it.
- Preserve signatures (Feathers): when extracting or delegating, copy the
  whole parameter list verbatim rather than retyping it — transcription of
  types and argument order is where silent bugs enter.
- Lean on the compiler (Feathers): to find every site a change touches,
  deliberately break the declaration — rename it, or change its type — and
  read the errors instead of grepping. Blind spot: inheritance and
  overloading satisfy silently — deleting a method that also exists on a
  base class raises no error and hides real callers — so this finds
  structural uses, not polymorphic ones.
- Reordering statements and splitting expressions are functional changes,
  not refactors: no tool verifies them, and a green characterisation test
  can still hide a broken extraction — narrowing a type (double→int)
  truncates silently unless an input forces the conversion to bite. Choose
  inputs that exercise each conversion on the moved path.

## Requalify behaviour — modernising is not feature parity

Characterisation pins what the code does; it does not tell you what to keep.
Do not derive the target's requirements by reverse-engineering the legacy:
much of what you find is dead — experiments that never caught on, features
superseded or quietly disabled — or workaround-shaped, where users improvised
around missing capability. Carrying it all forward replicates waste and
fossilises the workarounds.

Legacy rarely has usage analytics, so instrument it: add logging or metrics
to learn which paths real users actually hit, then confirm the dead ones with
stakeholders before dropping them. Recover the intent behind what remains
from users and production behaviour, not from the code — the code records
only the current, possibly poor, solution.

## Deployment confidence: bootstrap order

Order chosen for risk reduction per unit of retrofit effort on a legacy app:

1. Reproducible build plus a smoke-test promotion gate: boots, serves, core
   happy path. Cheapest signal, stops broken artefacts cold.
2. Application-level feature flags. They separate deploy from release and give
   an instant kill switch with no redeploy — and need no infrastructure
   retrofit, which is why they precede canary. Flags are debt too: each needs
   an owner and a retirement condition, like any scaffolding.
3. Progressive exposure using those flags: team → internal → beta → small
   percentage → everyone.
4. A small watched-metric set against baseline: request error rate, p99
   latency, one business metric. Abort on relative regression.
5. Only then: blue-green/canary infrastructure and automated rollback
   analysis.

Roll-back beats roll-forward while trust is low: flag-off is instant and
reversible; schema changes are not — which is exactly why schema work stays
expand/contract (see migration-patterns.md) so the risky app-level change is
the flag-guarded, reversible one.

## The AI-generated codebase: what's actually different

Practitioner reports consistently find that classic legacy discipline carries
the rescue and matters *more*, not less. The recurring deltas:

- **Readability stops being a triage signal.** In human legacy, surface mess
  loosely tracks risk, so "this looks awful" is a usable pointer; AI-generated
  code reads plausibly everywhere while the system-level design is incoherent,
  so cleanliness stops correlating with soundness. Triage by blast radius
  (what fails first, worst, or one bad input from a breach) and by hotspots
  instead.
- **The dominant debt is bloat, not tangle**: near-duplicate code paths
  (one per generation session), ceremonial abstractions applied regardless of
  scale, dead placeholder subsystems still wired in. Debloat in structural
  order — dead code, placeholder subsystems, real duplication, redundant
  layers — before any cosmetic pass. Deleting comments is not simplification:
  the system gets quieter, not simpler.
- **Assume secrets are compromised.** Scan the full git history and CI logs,
  not just HEAD; rotate everything found rather than moving it; kill
  client-bundle exposure via framework public prefixes (`NEXT_PUBLIC_`,
  `VITE_`); add cloud-spend alerts as a leak backstop.
- **Repeated fix-prompting compounds defects.** When an AI-authored unit is
  wrong, prefer pinning behaviour and cleanly rewriting the small unit under
  the net over iterating patches on top of it.

## Using agents on the rescue

- Read-only comprehension is the safest, highest-value agent use: have the
  agent draft a comprehension memo (what this does, who calls it, invariants
  observed) before any change, depth scaled to risk. Agents cannot recover
  unwritten intent — that gap is the human's to fill, from users, tickets,
  and production behaviour.
- Agents draft characterisation tests well; the human review that matters is
  *which behaviours are captured*, not whether assertions pass — the reviewer
  injects the tribal knowledge the agent structurally lacks. No
  characterisation net, no agent refactor in that area.
- Keep agents out of autonomous edits where their context is structurally
  incomplete: cross-cutting changes to widely-shared interfaces, implicit
  contracts (wire formats, column meanings), and auth/crypto/payments.
  Analysis yes, unsupervised edits no.
- After each cleanup, bound future agent work with the ratchets the SKILL.md
  requires plus orientation files (AGENTS.md/CLAUDE.md stating the canonical
  patterns), or the duplication and ceremony grow straight back.
