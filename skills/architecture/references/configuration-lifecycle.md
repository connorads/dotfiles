# Configuration And Lifecycle

Read this when wiring a new service or entrypoint, when config reads are
scattered through the code, or when tests need to substitute dependencies.

Parse configuration at startup, or the earliest boundary, into typed values with
useful failure context. Do not read environment or settings throughout the code.

Avoid top-level side effects outside true entrypoint/bootstrap code: modules
should not open connections, read configuration, register handlers, or start
servers at import time. Own resource creation and cleanup explicitly in the
shell. Inject clock and randomness into dependency-bearing code; let pure
functions take time and random values as arguments. The env/clock/rng bans are
mechanically enforceable - see the `mechanical-enforcement` skill's purity rules.

Wire dependencies in one composition root in the bootstrap/entrypoint and pass
them inward as explicit arguments. That single wiring point is also the one place
to substitute every dependency with a fake in tests, which beats patching
imports. A port can be a plain function for a single-method dependency - reserve a
richer interface for a genuinely multi-method one. Reach for manual injection
once you have more than one adapter, and hand-wire the graph in one composition
root by default (pure DI) - one root per process, however deep the graph: depth
is not the trigger, and hand-wiring keeps a wrong graph a compile error. A
container is optional tooling: it earns its keep when convention-based
registration beats writing the wiring out, or when scoped lifetimes and disposal
ordering need managing - and it trades compile-time verification for run-time
resolution errors. Keep every reference to it inside the composition root.
