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
eagerly, decide purely, then act once.

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

## Domain Modelling

Parse, don't validate repeatedly. Convert untrusted inputs at the boundary into
typed values that internal code can trust.

Prefer:

- discriminated unions / ADTs for state machines
- wrapper types for meaningful primitives such as `EmailAddress`, `OrderId`, or
  `CustomerId`
- precise names from the domain language
- bounded contexts with explicit translation between models

Avoid generic names like `data`, `info`, `manager`, and `helper` when the domain
has better words.

Avoid boolean blindness. Model meaningful lifecycle states as discriminated
unions, not bags of `isX`/`isY` flags, and avoid boolean parameters that switch
behaviour — use named options or domain types. Booleans are fine as predicate
return values.

Prefer strong types at boundaries and avoid type-system escape hatches unless
the project has a documented reason. Use mechanical enforcement for stack-level
rules such as no `any`, no non-null assertions, and strict type checking.

## Error Handling

Use explicit error values in domain and application logic. Exceptions are fine
at the imperative shell; catch and translate them there.

Make expected failures part of the use-case flow. Preserve causes when wrapping
unexpected infrastructure failures. Keep the happy path readable without hiding
failure handling.

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

## Workflows, Transactions, Idempotency

Use a plain call or a single database transaction for simple single-boundary
operations. Reach for a saga or durable workflow when the process needs retries,
compensation, idempotency, resumability, timers, human approval, or coordination
across services and multiple transaction boundaries.

Do not hold a database transaction open across network calls or long-running
work. Any command, job, or step that may be retried needs an explicit
idempotency strategy — idempotency key, natural unique constraint, deduplication
record, state-machine guard, or transactional outbox/inbox. Do not rely on
"probably safe" repeated side effects.

## Scale Rule

For simple scripts, strong types and a clear gather/decide/act flow are enough.
For substantial domains, use explicit ports, typed domain models, and a walking
skeleton that proves one end-to-end use case before expanding.
