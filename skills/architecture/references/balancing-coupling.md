# Balancing Coupling

Read this when a boundary feels wrong, someone says "decouple it", a rule
ripples across services, or you are deciding whether strongly-related code
belongs together or apart.

When a boundary feels wrong, do not reflexively "decouple it". Score it on three
axes (Khononov) and rebalance the one you can actually move:

- **Strength** - how much knowledge crosses, weakest to strongest: a purpose-built
  *contract* < sharing your internal *domain model* < *functional* coupling
  (interrelated rules, a shared transaction, enforced ordering, or a duplicated
  rule) < *intrusive* coupling (reaching past the interface into private internals
  or another service's database). Strength predicts how often a change on one side
  ripples to the other.
- **Distance** - the effort a joint change costs: methods in a class < classes in a
  module < modules < services < separate systems. Separate teams, time zones, and
  ownership widen it (Conway); a synchronous runtime dependency narrows it.
- **Volatility** - how often the upstream side actually changes. A
  core/differentiating domain is volatile; supporting, generic, and frozen-legacy
  code are not (identified as in SKILL.md's Scale Rule).

**Strength and distance should be inverse.** Strong coupling belongs close - that
is cohesion, so put it in one module or aggregate. Weak coupling can live far
apart - that is loose coupling. Matching values are the two failure modes:

- strong + far - the distributed-mud trap: a rule ripples across services, easy to
  miss one copy and leave the system inconsistent. Fix by cutting strength
  (introduce a contract) or pulling the pieces together.
- weak + close - clutter: unrelated code crammed together, so every change means
  hunting for the part that matters. Fix by pulling it apart.

Volatility is the tie-breaker: an imbalanced boundary is tolerable while its
upstream rarely changes, because there is no cascade to pay for - reading a frozen
legacy database directly can be fine (cf. the anti-corruption layer in SKILL.md's
Ports And Adapters, which optimises for model integrity rather than maintenance
cost). The same boundary becomes a problem the moment its upstream turns core;
then rebalance by cutting strength or distance.

You cannot always cut strength. When the business genuinely needs one transaction,
strict ordering, or strong consistency, the coupling is essential - no refactor
removes it, so distance is the only lever: colocate the pieces. That is what an
aggregate does (bind transactionally-coupled entities close, reference the rest by
id).

Two corrections to common instincts:

- **A duplicated business rule is among the strongest coupling there is**, yet
  nothing in the dependency graph reveals it. Two services that each decide
  "qualifies for free shipping" must change in lockstep or contradict each other.
  Prefer a single owner; duplicate only a rule that is trivial and stable.
- **Async is not decoupling.** Moving a call onto a message bus changes runtime and
  availability coupling, not how much knowledge the two sides share. If the message
  carries your internal model or the consumer reimplements your rule, the boundary
  is as strongly coupled as the synchronous version. Shrink shared knowledge with a
  contract; the transport is a separate concern (`event-driven-architecture`).
