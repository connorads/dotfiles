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

## Scale Rule

For simple scripts, strong types and a clear gather/decide/act flow are enough.
For substantial domains, use explicit ports, typed domain models, and a walking
skeleton that proves one end-to-end use case before expanding.
