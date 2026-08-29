# Balancing Coupling

Read this when a boundary feels wrong, someone says "decouple it", a rule
ripples across services, or you are deciding whether strongly-related code
belongs together or apart.

The model is Vlad Khononov's, *Balancing Coupling in Software Design*
(Addison-Wesley, 2024); his name for the first axis is **integration strength**.

When a boundary feels wrong, do not reflexively "decouple it". Score it on three
axes and rebalance the one you can actually move:

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
  code are not (identified as in SKILL.md's Scale Rule). Judge it from the
  subdomain, not commit history: churn can be accidental (caused by the very
  imbalance you are scoring), and stillness can mean change is too risky to
  attempt, not that the business stopped asking.

**Coupling is relative to a change** (Beck, after Constantine): two elements are
coupled when changing one forces changing the other *for a change you actually
want to make*, so score against the changes the roadmap is really asking for -
coupling no change triggers costs nothing. **Decoupling has its own cost**: the
test is cost(decoupling) + cost(change) < cost(coupling) + cost(change), and
code threading a value through six indirections is as expensive as the ripple
it avoided. Aim for the balance point, not zero.

**Strength and distance should be inverse.** Strong coupling belongs close - that
is cohesion, so put it in one module or aggregate. Weak coupling can live far
apart - that is loose coupling. Khononov's rule in one line:
`balance = (strength XOR distance) OR NOT volatility` - both high is distributed
mud, both low is clutter, either alone is modularity, and a low-volatility
upstream excuses either. Matching values are the two failure modes:

- strong + far - **global complexity**, the distributed-mud trap: a rule ripples
  across services, easy to miss one copy and leave the system inconsistent. Fix
  by cutting strength (introduce a contract) or pulling the pieces together.
- weak + close - **local complexity**, clutter: unrelated code crammed together,
  so every change means hunting for the part that matters. Fix by pulling it
  apart.

Modularity is the absence of both.

Volatility is the tie-breaker: an imbalanced boundary is tolerable while its
upstream rarely changes, because there is no cascade to pay for - reading a frozen
legacy database directly can be fine (cf. the anti-corruption layer in SKILL.md's
Ports And Adapters, which optimises for model integrity rather than maintenance
cost). The same boundary becomes a problem the moment its upstream turns core;
then rebalance by cutting strength or distance. The moves pair: a change that
increases distance must cut strength in the same change, or you have simply
bought global complexity.

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
- **Async is not decoupling - it is worse than neutral.** Async *increases*
  distance (it cuts lifecycle coupling), so moving a strongly-coupled call onto a
  bus shifts the boundary from strong+near, which is balanced, towards
  strong+far, the distributed-mud trap. Buying distance obliges you to pay for it
  by cutting strength - a real contract, not your internal model, and no consumer
  reimplementing your rule; the transport is a separate concern
  (`event-driven-architecture`).
