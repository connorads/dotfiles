---
name: architecture
description: >
  Design or refactor software around clear boundaries, typed domain models, and
  testable flows. Use for substantial design work, hard-to-test code, domain
  modelling, ports/adapters, functional core / imperative shell, explicit error
  handling, observability, or when code structure is fighting the change.
---

# Architecture

Make the change easy, then make the easy change. Start by understanding the
domain language, workflows, and boundaries before adding structure.

## Decision Tree

```text
What kind of change is this?
|-- Simple script/tool
|   `-- Use strong types, clear parsing at boundaries, and a small imperative shell
|-- New substantial behaviour
|   `-- Sketch domain types, workflow, ports, and observable outcomes first
|-- Existing code is hard to test
|   `-- separate decisions from effects; introduce purpose-named ports
|-- Domain states are unclear
|   `-- model states explicitly and parse untrusted input at boundaries
`-- Failures are unclear
    `-- make domain/application errors explicit and translate at the shell
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

## Ports And Adapters

Define ports in the application's language, not the technology's language.

- Good: `Orders`, `Receipts`, `EmailDelivery`, `Clock`
- Weak: `PostgresClient`, `S3Helper`, `HttpManager`

Adapters implement ports with specific technology. Application logic depends on
ports and values. If tests for application decisions require real
infrastructure, a boundary is probably missing.

Use fakes for owned ports in application tests. Use contract/integration tests
to prove adapters fulfil the port.

Before adding a new adapter, audit existing ones: reuse through a narrow port,
then extend an existing adapter when the capability fits, then create a new one
only when reuse and extension would force bad coupling. Record a meaningful new
adapter and its rejected alternatives where decisions are kept.

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
- bounded contexts with explicit translation between models

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

## Observability

Design system boundaries with observability in mind:

- structured logs over free-text logs
- operation names
- relevant entity IDs
- request/correlation IDs
- timing and outcome at HTTP, database, queue, and external-service boundaries

The core should decide what happened. The shell should record it with the
context needed to debug production behaviour.

## Configuration And Lifecycle

Parse configuration at startup, or the earliest boundary, into typed values with
useful failure context. Do not read environment or settings throughout the code.

Avoid top-level side effects outside true entrypoint/bootstrap code: modules
should not open connections, read configuration, register handlers, or start
servers at import time. Own resource creation and cleanup explicitly in the
shell. Inject clock and randomness into dependency-bearing code; let pure
functions take time and random values as arguments.

Wire dependencies in one composition root in the bootstrap/entrypoint and pass
them inward as explicit arguments. That single wiring point is also the one place
to substitute every dependency with a fake in tests, which beats patching
imports. A port can be a plain function for a single-method dependency — reserve a
richer interface for a genuinely multi-method one. Reach for manual injection
once you have more than one adapter, and for a dependency-injection framework only
when dependencies have their own dependencies (chained graphs); below that it is
overengineering.

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
function.

## Workflows, Transactions, Idempotency

An aggregate is both the consistency boundary and the unit of persistence: route
all changes through its root, and update only one aggregate per transaction.
Link aggregates by id, never by embedding one in another. When an operation
seems to need two aggregates atomically, suspect a missing entity (model the
operation itself) or use eventual consistency. Across services, prefer async
events to distributed transactions, with an explicit recovery path — reconcile
or compensate. Eventual consistency is not optional consistency; it must still
converge.

Use a plain call or a single database transaction for simple single-boundary
operations. Reach for a saga or durable workflow when the process needs retries,
compensation, idempotency, resumability, timers, human approval, or coordination
across services and multiple transaction boundaries.

Do not hold a database transaction open across network calls or long-running
work. Any command, job, or step that may be retried needs an explicit
idempotency strategy — idempotency key, natural unique constraint, deduplication
record, state-machine guard, or transactional outbox/inbox. Do not rely on
"probably safe" repeated side effects.

Concurrency control is distinct from idempotency: idempotency makes a retry safe;
concurrency control stops two simultaneous writers clobbering each other — the
lost update. Hold the consistency boundary under concurrent writes by versioning
the aggregate (optimistic locking): bump a version on write, let one transaction
commit, and make the loser reload and retry. Reach for pessimistic locks
(`SELECT ... FOR UPDATE`) when conflicts are frequent and a retry is expensive,
minding deadlocks; raising the isolation level to `SERIALIZABLE` lets the database
enforce the rule but is slower, so prefer a targeted version check. Pick by
conflict rate and the cost of a lost update.

Make the transaction boundary safe by default: the only path that commits is
total success plus an explicit commit, and any exception or early exit rolls
back. Design the default to change nothing and require a positive act to persist.

## Reads And Writes

Separate reads from writes. At the call level, a function either changes state or
answers a question, never both (command-query separation). At system scale the
same split is CQRS: the write model is shaped by invariants, not by how screens
query it — a domain model is not a data model — so reads need not travel through
the aggregate. Default to the same store and repository for both. Reach for a
separate read model — a denormalised view keyed for the query, kept fresh from
the domain events the write side already emits — only when the read shape
genuinely diverges or a performance wall demands it. Treat CQRS as a last resort,
not a default: splitting read-only views out from command handlers captures most
of the benefit without a second store.

## Scale Rule

Scope the investment by domain, not just by size. For simple scripts, strong
types and a clear gather/decide/act flow are enough. For a substantial core
domain — the part that differentiates the business — use explicit ports, typed
domain models, aggregates where consistency demands them, and a walking skeleton
that proves one end-to-end use case before expanding. For supporting subdomains,
model lightly; for generic ones (auth, billing, search, notifications), buy or
adopt an existing solution rather than modelling it yourself.
