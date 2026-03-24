# Dependency Categories

When assessing a candidate for deepening, classify its dependencies. This determines the testing strategy and whether deepening is viable.

## 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — merge the modules and test directly.

**Test strategy:** Unit tests with real values, no doubles.

## 2. Local-substitutable

Dependencies with local test stand-ins (e.g. PGLite for Postgres, SQLite for a relational DB, in-memory filesystem). Deepenable if the stand-in exists. The deepened module is tested with the stand-in running in the test suite.

**Test strategy:** Integration tests with local stand-in.

## 3. Remote-owned (ports & adapters)

Your own services across a network boundary (microservices, internal APIs). Define a port (interface) at the module boundary. The deep module owns the logic; transport is injected.

**Test strategy:** In-memory adapter for tests, real HTTP/gRPC adapter for production. Consumer-driven contract tests (Pact-style) if the remote service has its own release cycle.

**Recommendation shape:** "Define a shared interface (port), implement an HTTP adapter for production and an in-memory adapter for testing, so the logic can be tested as one deep module even though it's deployed across a network boundary."

## 4. True external (mock at boundary)

Third-party services (Stripe, Twilio, etc.) you don't control. Mock at the boundary. The deepened module takes the external dependency as an injected port, and tests provide a mock implementation.

**Test strategy:** Mock/stub at the boundary only. Record real responses for regression tests if the API is stable.

## Relationship to Khorikov's taxonomy

This extends Vladimir Khorikov's categories (from *Unit Testing: Principles, Practices, and Patterns*) with a practical distinction: Khorikov separates managed vs unmanaged out-of-process dependencies, but doesn't distinguish between your own remote services (where contract tests are possible) and true third-party services (where you can only mock). That distinction matters for choosing a testing strategy.

| This taxonomy | Khorikov equivalent |
|---------------|-------------------|
| In-process | In-process, private |
| Local-substitutable | Out-of-process, managed |
| Remote-owned | Out-of-process, unmanaged (your org) |
| True external | Out-of-process, unmanaged (third party) |
