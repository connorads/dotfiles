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
mechanically enforceable — see the `mechanical-enforcement` skill's purity rules.

Wire dependencies in one composition root in the bootstrap/entrypoint and pass
them inward as explicit arguments. That single wiring point is also the one place
to substitute every dependency with a fake in tests, which beats patching
imports. A port can be a plain function for a single-method dependency — reserve a
richer interface for a genuinely multi-method one. Reach for manual injection
once you have more than one adapter, and for a dependency-injection framework only
when dependencies have their own dependencies (chained graphs); below that it is
overengineering.
