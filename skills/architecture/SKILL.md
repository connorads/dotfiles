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
without stopping delivery, the `refactoring` skill owns the path - strangler
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
|-- Boundaries unknown / new domain / experts disagree
|   `-- discover before scoring (Finding Boundaries)
|-- A boundary feels wrong / "should we decouple this?"
|   `-- score strength, distance, volatility (references/balancing-coupling.md)
|-- Retries, sagas, consistency, concurrent writers
|   `-- references/workflows-transactions.md
|-- Query shapes fighting the domain model / CQRS question
|   `-- references/reads-and-writes.md
|-- New boundary, or production behaviour hard to debug
|   `-- decide what it emits before building it (references/observability.md)
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

The check is the shape: the shell carries the dependencies and almost no
branches; the core carries every branch and no dependencies (Bernhardt). A
conditional in the shell is a decision that leaked out of the core.

Challenge effects that appear to need interleaving. Often the code can fetch
eagerly, decide purely, then act once. Have the core return a value describing
what should happen - a decision or a list of events - and let the shell perform
it. Returning events rather than publishing them keeps the core pure and lets a
test assert on the returned value.

Durable-execution engines (Temporal, Restate, DBOS) enforce a neighbouring rule
at runtime: the *control flow* must be deterministic so it can be replayed from a
journal, with IO, clocks, and randomness confined to journaled steps. Replayable
is not pure - the workflow still orchestrates effects - but they are the
sanctioned way to run genuinely *interleaved* effects, the case that relaxes
"act once" when a flow is long-running (timers, human approval, retries over
days), rather than a smell to design away. Two things the journal does not buy:
steps are at-least-once, so a step with an external side effect still needs its
own idempotency key, and changing the step sequence breaks in-flight executions,
so pin an execution to the build that started it. Adoption is not one price
either - DBOS is a library over your own Postgres, Restate a sidecar, Temporal a
cluster - and Step Functions has no user workflow code at all: the state machine
is data, so no determinism constraint applies.

## Ports And Adapters

Define ports in the application's language, not the technology's language.

- Good: `Orders`, `Receipts`, `EmailDelivery`, `Clock`
- Weak: `PostgresClient`, `S3Helper`, `HttpManager`

Adapters implement ports with specific technology. Application logic depends on
ports and values. If tests for application decisions require real
infrastructure, a boundary is probably missing.

Ports are two-sided. **Driven** ports are what the application needs - `Orders`,
`EmailDelivery`, `Clock` - and adapters implement them. **Driving** ports are
what it offers: the use cases, implemented by the application and called by
adapters - HTTP controller, CLI, queue consumer, batch job, test harness.
Cockburn's intent is an application "driven equally by users, programs,
automated test or batch scripts", so the test harness is a first-class driver,
not a testing trick - it is what makes the walking skeleton checkable on day
one. A port is a purposeful conversation, not one method: group the use cases
one kind of caller needs into one driving port.

Use fakes for owned ports in application tests. Use contract/integration tests
to prove adapters fulfil the port.

At a boundary to a legacy or third-party system whose model you do not
control, make the adapter an anti-corruption layer (Evans): translate their
model into your domain types at the edge so their shape never leaks inward. In
a migration this is the seam where the new model meets the old - and unlike
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

Pull complexity downward (Ousterhout, *A Philosophy of Software Design*) - but
only where it is closely related to the module's existing job, simplifies many
call sites, and simplifies the interface; absorbing a caller's concern is
information leakage wearing a deep module's clothes. A module has more callers
than authors, so a simple interface over a complex body beats the reverse:
absorb the hard cases inside rather than exposing flags and knobs to callers. A
layer whose interface is about as complex as its body is shallow - a
pass-through method or thin wrapper that hides nothing adds interface cost for
no gain, so merge or delete it. The sharper test: a layer whose abstraction is
the same as its neighbour's is the red flag, whatever its line count.

Over-decomposition is the mirror failure. Split where the pieces are
independent, not everywhere: two chunks you must read together to understand
either are entangled, so separating them adds an interface and hides nothing
(Ousterhout: "if two pieces of code are tightly related, the solution is to
bring them together"). Step count is not the goal.

These red flags target layers that hide nothing; what earns a seam is
contributing distinct functionality - deliberate ports/adapters and
substitutable pipeline steps qualify. The `typescript` skill owns the mechanics
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
module one narrow public surface and keep the rest internal - a folder full of
public types provides no protection however it is named. Keep cross-module
calls on explicit interfaces so a module can later be deployed separately
without rewiring. Default to a modular monolith with enforced
boundaries; split out a deployable only when scaling, deploy cadence, or team
ownership forces it. When a split is forced, cut on a fracture plane rather
than convenience (Skeleton & Pais): bounded context first, then change cadence,
regulatory scope, performance isolation, or team location - the litmus test is
cognitive load: could one team own this and offer it to the others as a
service? If several teams must hold the same semantics to ship anything, the
cut is in the wrong place. Modules need not share one internal shape - a complex
pricing core earns a rich domain model while a reporting module stays plain
queries (see Scale Rule).

A bounded context is a language boundary - the span within which one term keeps
one meaning - not a folder, a module, or a service: one deployable can hold
many, and extracting a service that was never a context boundary just
distributes the mud. 'Customer' in shipping is not 'Customer' in billing, and
unifying them is the error, not the fix (Evans). Name the relationship you
actually have with each neighbouring context - conformist, customer-supplier,
shared kernel, open-host, separate ways, anti-corruption layer; the ACL buys
model integrity at the highest running cost, so pick it deliberately.

## Finding Boundaries

Boundaries are an output of modelling, not an input. In a new or contested
domain, make the flow visible with the people who do the work - past-tense
events in time order - and mark disagreements rather than resolving them: two
experts who contradict each other are usually both right in their own place,
and that is where the context boundary is (Brandolini); a term changing meaning
is the same signal (Evans). Drive to a plausible end-to-end story, then
re-inject the corner cases you parked - the rosy scenario proves nothing.

## Balancing Coupling

When a boundary feels wrong, do not reflexively "decouple it". Score it on
three axes (Khononov) - **strength** (how much knowledge crosses), **distance**
(the effort a joint change costs), **volatility** (how often the upstream
actually changes) - and rebalance the one you can actually move. Strength and
distance should be inverse: strong coupling belongs close (cohesion), weak can
live far apart. The full model - the strength ladder, the two failure modes,
the volatility tie-breaker, and why duplicated rules and async transports fool
the instinct - is in references/balancing-coupling.md.

## API Contracts

An API is a module's public surface at a system boundary; the same
encapsulation rule applies with the stakes raised, because consumers are far
away and cannot be refactored with you. An API shaped by your schema shares
your internal model at maximum distance - the strong-plus-far trap (see
references/balancing-coupling.md).

Derive endpoints from consumer jobs, not from the schema. Given a vague ask
("an API to manage bookings"), the reflex failure is anchoring on the central
table and shipping its row lifecycle as the API - while every job that spans
tables (sign up and book, cancel with refund, take payment) silently becomes
unservable. Before writing endpoints, list the jobs the consumer must
complete and check each is achievable end-to-end through the API; a job the
schema spreads across tables still needs a first-class operation.

Model workflow operations as actions, not status writes: `POST
/bookings/{id}/cancel`, not `PATCH /bookings/{id}` with a status field. A
status write invites implementing the transition table and dropping the
operation's side effects (the refund, the freed capacity); an action route
makes "what happens when this occurs" the unit of design. When the operation
is a reaction rather than a request, it is an event -
`event-driven-architecture` owns the mechanics.

Design the second version before shipping the first. Default to additive
change - new optional fields and new operations, never a repurposed one. When a
break is genuinely required, keep one canonical implementation and isolate the
old shape in a version transform at the edge (Stripe's version-change modules:
consumers pin a version, responses are downgraded on the way out), so the
domain never grows an `if v1` branch. Publish each break with a named deletion
condition, not an open-ended shim.

## Domain Modelling

Parse, don't validate (King). A check that answers yes/no throws away what it
learned; convert untrusted inputs at the boundary into typed values that carry
the evidence, so downstream code cannot face a case already ruled out. Treat
every inbound boundary this way - including your own database and configuration: parse rows and settings
back into domain types on the way in rather than trusting them.

Store the input to a business rule, not the value it derives. Persist the raw
fact (`dateOfBirth`) and compute the derived value (`age`) on read, so it tracks
current rules; a stored verdict couples the model to today's rules and forces a
migration when they change. The exception is a decision you acted on: snapshot
its output as an immutable fact (charged price, order total, applied discount,
tax) precisely because it must survive rule changes - the same instinct as
`OrderPlaced` events.

Keep look-alike types separate. Two concepts that share fields today - billing
vs shipping address, a validated vs a priced line - diverge under new
requirements. Coincidental structural sameness is not a reason to unify;
resisting DRY here lets each evolve independently.

Prefer:

- discriminated unions / ADTs for state machines
- wrapper types for meaningful primitives such as `EmailAddress`, `OrderId`, or
  `CustomerId` - distinct even when the representation is identical (an `OrderId`
  must never be assignable where a `CustomerId` is expected) and worthwhile even
  with nothing to validate, purely to stop mix-ups
- precise names from the domain language
- bounded contexts with explicit translation between your own models; a
  foreign system's model gets the anti-corruption layer (see Ports And
  Adapters)

Avoid generic names like `data`, `info`, `manager`, and `helper` when the domain
has better words.

Make illegal states unrepresentable (Minsky's phrase, carried into domain
modelling by Wlaschin): model meaningful lifecycle states as
discriminated unions, not bags of `isX`/`isY` flags, so invalid combinations
cannot be constructed and need no runtime check. Avoid boolean blindness - no
boolean parameters that switch behaviour; use named options or domain types.
Booleans are fine as predicate return values.

Prefer strong types at boundaries and avoid type-system escape hatches unless
the project has a documented reason. Use mechanical enforcement for stack-level
rules such as no `any`, no non-null assertions, and strict type checking.

## Error Handling

Use explicit error values in domain and application logic. Exceptions are fine
as private control flow inside a module, and at the imperative shell where you
catch and translate them - the test is escape, not layer: they must not cross a
public boundary. Return a typed error only where a consumer will branch on it;
one nobody acts on is a log line, not a domain type.

Triage every failure into one of three kinds (after Wlaschin):

- domain errors - expected business outcomes; model them as typed values in the
  domain language
- panics - bugs and impossible states; throw and let them crash, caught once at
  the top
- infrastructure errors - timeouts, auth, outages; handle per architecture, and
  promote to a domain error when the business outcome changes (then ask a domain
  expert what should happen)

Make expected failures part of the use-case flow. Preserve causes when wrapping
unexpected infrastructure failures. Keep the happy path readable without hiding
failure handling.

Define errors out of existence where the domain allows. Before adding an error
branch, try broadening the operation so the awkward input has an ordinary result -
model "no selection" as an empty range, make `remove` ensure-absent rather than
fail on a missing key. A deleted branch beats a well-handled one: illegal states
made unrepresentable, applied to behaviour rather than data. This is not licence
to swallow real failures - if a domain expert would want the edge surfaced, it is
a domain error: keep it a typed value and let the triage stand.

## Workflows as Pipelines

Reach for this apparatus - workflows-as-pipelines, aggregates, domain events,
bounded contexts - where business complexity and domain-expert collaboration
justify it: the core domain. For technical, generic, or simpler subdomains,
plain functions, a single transaction, and strong types are enough; don't impose
the ceremony. DDD is not appropriate for all software - match the modelling style
to the domain (see Scale Rule).

Model each use case as one workflow: a command in, a list of domain events out,
contained in a single bounded context. Name events as past-tense facts
(`OrderPlaced`), distinct from the command that requests them - a command may
fail; an event is a fact that happened.

Compose a workflow from small single-purpose steps wired output-to-input. Give
each step a typed input, a typed output, and explicit dependencies. Only a step
that can genuinely fail returns an error type - a step that cannot fail is
lifted into the pipeline, not rewritten to lie about itself. Wlaschin, who named
railway-oriented programming, warns against taking it to extremes: forcing
`Result` on every step collapses errors into one lowest-common-denominator
union and buries the ones a caller branches on. Keep each step stateless and
pure so it is testable in isolation; push I/O to the ends.

Two weights of "events": returning events as values from the core - a list of
what happened, instead of a `void` mutation - is cheap and broadly worthwhile,
even in simple code. Event sourcing and async event choreography are independent
decisions, not one heavy thing. Event source an aggregate when its history *is*
the requirement - temporal queries, audit or regulatory history, replay for
debugging or process reconstruction; otherwise current state is enough (a cart's
add/remove churn before checkout is working state; the order from checkout on is
a fact). Applying it everywhere is the commonest failure (Young). Choreograph
across services only when the coordination genuinely warrants it - a separate
question; cross-context scenarios are then choreographed by events, not one
giant function. Once an event crosses a process or service boundary, the
`event-driven-architecture` skill owns the mechanics - propagation, reliable
publication, delivery semantics, and versioning. The transactional side -
aggregates as consistency boundaries, sagas, idempotency, concurrency control -
is in references/workflows-transactions.md.

## Scale Rule

Scope the investment by domain, not just by size. For simple scripts, strong
types and a clear gather/decide/act flow are enough. For a substantial core
domain - the part that differentiates the business - use explicit ports, typed
domain models, aggregates where consistency demands them, and a walking skeleton
that proves one end-to-end use case before expanding. For supporting subdomains,
model lightly; for generic ones (auth, billing, search, notifications), buy or
adopt an existing solution rather than modelling it yourself.

Identify the core by differentiation, not centrality: the capability customers
most obviously use is often table stakes - reliable, unremarkable, better
bought or kept plain (a ride-hailing journey flow, a payments integration).
Invest the rich model where differentiation potential and model complexity are
both high, and re-score over time - today's core drifts toward supporting as
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
