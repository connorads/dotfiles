---
name: architecture
description: >
  Design the target structure of software: clear boundaries, typed domain
  models, and testable flows. Use for substantial design work, hard-to-test
  code, domain modelling, module organisation, API and endpoint contract
  design, ports/adapters, functional core
  / imperative shell, explicit error handling, observability, or when code
  structure is fighting the change. Defines the target shape; the refactoring
  skill owns the migration path that moves existing code there safely.
---

# Architecture

Make the change easy, then make the easy change. Start by understanding the
domain language, workflows, and boundaries before adding structure.

This skill decides the target shape. When existing code must be moved there
without stopping delivery, the `refactoring` skill owns the path — strangler
fig, branch by abstraction, parallel change, seams.

## Decision Tree

```text
What kind of change is this?
|-- Simple script/tool
|   `-- Use strong types, clear parsing at boundaries, and a small imperative shell
|-- New substantial behaviour
|   `-- Sketch domain types, workflow, ports, and observable outcomes first
|-- Designing or extending an API/endpoint
|   `-- derive operations from consumer jobs, not the schema (API Contracts)
|-- Existing code is hard to test
|   `-- separate decisions from effects; introduce purpose-named ports
|-- Domain states are unclear
|   `-- model states explicitly and parse untrusted input at boundaries
|-- Failures are unclear
|   `-- make domain/application errors explicit and translate at the shell
|-- A boundary feels wrong / "should we decouple this?"
|   `-- score strength, distance, volatility (references/balancing-coupling.md)
|-- Retries, sagas, consistency, concurrent writers
|   `-- references/workflows-transactions.md
|-- Query shapes fighting the domain model / CQRS question
|   `-- references/reads-and-writes.md
|-- Production behaviour hard to debug
|   `-- references/observability.md
`-- Wiring a service: config, bootstrap, dependency injection
    `-- references/configuration-lifecycle.md
```

## Functional Core, Imperative Shell

Keep business decisions in a pure core where practical. Put I/O, framework
objects, clocks, random IDs, environment access, and network/database calls at
the shell.

Use the sandwich:

```text
gather data and dependencies -> decide with pure values -> perform effects
```

Challenge effects that appear to need interleaving. Often the code can fetch
eagerly, decide purely, then act once. Have the core return a value describing
what should happen — a decision or a list of events — and let the shell perform
it. Returning events rather than publishing them keeps the core pure and lets a
test assert on the returned value.

Durable-execution engines (Temporal, Step Functions, Restate) enforce this rule at
runtime: deterministic workflow code as the pure control flow, with IO, clocks, and
randomness confined to activities (Temporal: "workflow code must be deterministic
... put non-deterministic operations in Activities"). They are also the sanctioned
way to run genuinely *interleaved* effects safely - the case that relaxes "act
once" when a flow is long-running (timers, human approval, retries over days),
rather than a smell to design away.

## Ports And Adapters

Define ports in the application's language, not the technology's language.

- Good: `Orders`, `Receipts`, `EmailDelivery`, `Clock`
- Weak: `PostgresClient`, `S3Helper`, `HttpManager`

Adapters implement ports with specific technology. Application logic depends on
ports and values. If tests for application decisions require real
infrastructure, a boundary is probably missing.

Use fakes for owned ports in application tests. Use contract/integration tests
to prove adapters fulfil the port.

At a boundary to a legacy or third-party system whose model you do not
control, make the adapter an anti-corruption layer (Evans): translate their
model into your domain types at the edge so their shape never leaks inward. In
a migration this is the seam where the new model meets the old — and unlike
transitional scaffolding, it endures for as long as the foreign system does.
The exception is a genuinely frozen upstream: when the foreign model will not
change, an unwrapped boundary can be the cheaper trade (see
references/balancing-coupling.md's volatility tie-breaker).

Before adding a new adapter, audit existing ones: reuse through a narrow port,
then extend an existing adapter when the capability fits, then create a new one
only when reuse and extension would force bad coupling. Record a meaningful new
adapter and its rejected alternatives where decisions are kept.

After sketching layers and adapters, classify the boundaries by enforcement
surface. A direct "X must not import Y" rule belongs in the lint stack; a
transitive "domain must never reach runtime/DB/routes" rule belongs in a graph
architecture test. The architecture skill owns the boundary language and
trade-offs; `mechanical-enforcement` owns the exact rule and hook.

## Module Depth

Pull complexity downward. A module has more callers than authors, so a simple
interface over a complex body beats the reverse: absorb the hard cases inside
rather than exposing flags and knobs to callers. A layer whose interface is about
as complex as its body is shallow — a pass-through method or thin wrapper that
hides nothing adds interface cost for no gain, so merge or delete it.

This red flag targets abstraction layers that hide nothing — not deliberate
ports/adapters, nor pure pipeline steps kept for substitution or isolated
testability, which earn their seam. The `typescript` skill owns the mechanics
(deep, cohesive modules; the deletion test).

## Module Organisation

Organise top-level modules by business capability, not technical layer: a
feature's handlers, domain logic, and persistence live together in one slice
(`orders/`, `billing/`), not scattered across global `controllers/`,
`services/`, `repositories/` folders that force every change to touch all
three. Retrofitting global `domain/application/infrastructure` folders onto an
existing tangle yields four connected balls of mud; layering belongs *inside*
a capability, as a private detail.

The load-bearing mechanism is encapsulation, not folder names: give each
module one narrow public surface and keep the rest internal — a folder full of
public types provides no protection however it is named. Keep cross-module
calls on explicit interfaces so a module can later become a bounded context or
its own service without rewiring. Default to a modular monolith with enforced
boundaries; split out a deployable only when scaling, deploy cadence, or team
ownership forces it. Modules need not share one internal shape — a complex
pricing core earns a rich domain model while a reporting module stays plain
queries (see Scale Rule).

## Balancing Coupling

When a boundary feels wrong, do not reflexively "decouple it". Score it on
three axes (Khononov) — **strength** (how much knowledge crosses), **distance**
(the effort a joint change costs), **volatility** (how often the upstream
actually changes) — and rebalance the one you can actually move. Strength and
distance should be inverse: strong coupling belongs close (cohesion), weak can
live far apart. The full model — the strength ladder, the two failure modes,
the volatility tie-breaker, and why duplicated rules and async transports fool
the instinct — is in references/balancing-coupling.md.

## API Contracts

An API is a module's public surface at a system boundary; the same
encapsulation rule applies with the stakes raised, because consumers are far
away and cannot be refactored with you. An API shaped by your schema shares
your internal model at maximum distance — the strong-plus-far trap (see
references/balancing-coupling.md).

Derive endpoints from consumer jobs, not from the schema. Given a vague ask
("an API to manage bookings"), the reflex failure is anchoring on the central
table and shipping its row lifecycle as the API — while every job that spans
tables (sign up and book, cancel with refund, take payment) silently becomes
unservable. Before writing endpoints, list the jobs the consumer must
complete and check each is achievable end-to-end through the API; a job the
schema spreads across tables still needs a first-class operation.

Model workflow operations as actions, not status writes: `POST
/bookings/{id}/cancel`, not `PATCH /bookings/{id}` with a status field. A
status write invites implementing the transition table and dropping the
operation's side effects (the refund, the freed capacity); an action route
makes "what happens when this occurs" the unit of design. When the operation
is a reaction rather than a request, it is an event —
`event-driven-architecture` owns the mechanics.

## Domain Modelling

Parse, don't validate repeatedly. Convert untrusted inputs at the boundary into
typed values that internal code can trust. Treat every inbound boundary this
way — including your own database and configuration: parse rows and settings
back into domain types on the way in rather than trusting them.

Store the input to a business rule, not the value it derives. Persist the raw
fact (`dateOfBirth`) and compute the derived value (`age`) on read, so it tracks
current rules; a stored verdict couples the model to today's rules and forces a
migration when they change. The exception is a decision you acted on: snapshot
its output as an immutable fact (charged price, order total, applied discount,
tax) precisely because it must survive rule changes — the same instinct as
`OrderPlaced` events.

Keep look-alike types separate. Two concepts that share fields today — billing
vs shipping address, a validated vs a priced line — diverge under new
requirements. Coincidental structural sameness is not a reason to unify;
resisting DRY here lets each evolve independently.

Prefer:

- discriminated unions / ADTs for state machines
- wrapper types for meaningful primitives such as `EmailAddress`, `OrderId`, or
  `CustomerId` — distinct even when the representation is identical (an `OrderId`
  must never be assignable where a `CustomerId` is expected) and worthwhile even
  with nothing to validate, purely to stop mix-ups
- precise names from the domain language
- bounded contexts with explicit translation between your own models; a
  foreign system's model gets the anti-corruption layer (see Ports And
  Adapters)

Avoid generic names like `data`, `info`, `manager`, and `helper` when the domain
has better words.

Make illegal states unrepresentable: model meaningful lifecycle states as
discriminated unions, not bags of `isX`/`isY` flags, so invalid combinations
cannot be constructed and need no runtime check. Avoid boolean blindness — no
boolean parameters that switch behaviour; use named options or domain types.
Booleans are fine as predicate return values.

Prefer strong types at boundaries and avoid type-system escape hatches unless
the project has a documented reason. Use mechanical enforcement for stack-level
rules such as no `any`, no non-null assertions, and strict type checking.

## Error Handling

Use explicit error values in domain and application logic. Exceptions are fine
at the imperative shell; catch and translate them there.

Triage every failure into one of three kinds:

- domain errors — expected business outcomes; model them as typed values in the
  domain language
- panics — bugs and impossible states; throw and let them crash, caught once at
  the top
- infrastructure errors — timeouts, auth, outages; handle per architecture, and
  promote to a domain error when the business outcome changes (then ask a domain
  expert what should happen)

Make expected failures part of the use-case flow. Preserve causes when wrapping
unexpected infrastructure failures. Keep the happy path readable without hiding
failure handling.

Define errors out of existence where the domain allows. Before adding an error
branch, try broadening the operation so the awkward input has an ordinary result
— model "no selection" as an empty range, make `remove` ensure-absent rather than
fail on a missing key. A deleted branch beats a well-handled one: illegal states
made unrepresentable, applied to behaviour rather than data. This is not licence
to swallow real failures — if a domain expert would want the edge surfaced, it is
a domain error: keep it a typed value and let the triage stand.

## Workflows as Pipelines

Reach for this apparatus — workflows-as-pipelines, aggregates, domain events,
bounded contexts — where business complexity and domain-expert collaboration
justify it: the core domain. For technical, generic, or simpler subdomains,
plain functions, a single transaction, and strong types are enough; don't impose
the ceremony. DDD is not appropriate for all software — match the modelling style
to the domain (see Scale Rule).

Model each use case as one workflow: a command in, a list of domain events out,
contained in a single bounded context. Name events as past-tense facts
(`OrderPlaced`), distinct from the command that requests them — a command may
fail; an event is a fact that happened.

Compose a workflow from small single-purpose steps wired output-to-input. Give
each step a typed input, a typed output that includes its failure case, and
explicit dependencies. Keep each step stateless and pure so it is testable in
isolation; push I/O to the ends.

Two weights of "events": returning events as values from the core — a list of
what happened, instead of a `void` mutation — is cheap and broadly worthwhile,
even in simple code. Event sourcing and async event choreography across services
are heavy; use them only when the coordination genuinely warrants it, not as a
default. Cross-context scenarios are then choreographed by events, not one giant
function. Once an event crosses a process or service boundary, the
`event-driven-architecture` skill owns the mechanics — propagation, reliable
publication, delivery semantics, and versioning. The transactional side —
aggregates as consistency boundaries, sagas, idempotency, concurrency control —
is in references/workflows-transactions.md.

## Scale Rule

Scope the investment by domain, not just by size. For simple scripts, strong
types and a clear gather/decide/act flow are enough. For a substantial core
domain — the part that differentiates the business — use explicit ports, typed
domain models, aggregates where consistency demands them, and a walking skeleton
that proves one end-to-end use case before expanding. For supporting subdomains,
model lightly; for generic ones (auth, billing, search, notifications), buy or
adopt an existing solution rather than modelling it yourself.

Identify the core by differentiation, not centrality: the capability customers
most obviously use is often table stakes — reliable, unremarkable, better
bought or kept plain (a ride-hailing journey flow, a payments integration).
Invest the rich model where differentiation potential and model complexity are
both high, and re-score over time — today's core drifts toward supporting as
competitors catch up.

## Deep-dives (references/)

Read only when the situation matches; each file opens with its own
when-to-read line.

| Reference | Read when |
|---|---|
| references/balancing-coupling.md | a boundary feels wrong, "decouple it" is proposed, a rule ripples across services |
| references/workflows-transactions.md | operations span aggregates/services; retries, sagas, idempotency, lost updates |
| references/reads-and-writes.md | query shapes fight the domain model; CQRS or a read model is on the table |
| references/observability.md | designing a new boundary; production behaviour is hard to debug |
| references/configuration-lifecycle.md | wiring a service: config parsing, bootstrap, composition root, DI |
