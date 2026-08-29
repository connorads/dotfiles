# Configuration And Lifecycle

Read this when wiring a new service or entrypoint, when config reads are
scattered through the code, or when tests need to substitute dependencies.

Parse configuration at startup, or the earliest boundary, into typed values with
useful failure context. Do not read environment or settings throughout the code.
Three lifetimes arrive through that door:

- **Config** - parse once at startup into typed values; report every invalid
  key, refuse to start on bad config rather than failing on the first request
  that needs it, then stop reading.
- **Secrets** - they rotate, so one parsed at boot is a scheduled outage: take
  them through a provider port that can re-read, validate a new value before
  discarding the working one, and prefer a short-lived workload identity to a
  secret you must rotate.
- **Runtime-adjustable values** (feature flags, kill switches, log level,
  sampling) - dynamic by design: a port (`FeatureFlags`, `Limits`), evaluated in
  the shell per unit of work and passed inward as ordinary values, never read
  inline from an SDK - and recorded on that unit's telemetry event, since a flag
  you cannot see in the data is a branch you cannot explain. Swap one validated
  snapshot atomically, keeping last-good on a failed reload.

Avoid top-level side effects outside true entrypoint/bootstrap code: modules
should not open connections, read configuration, register handlers, or start
servers at import time. Own resource creation and cleanup explicitly in the
shell. Inject clock and randomness into dependency-bearing code; let pure
functions take time and random values as arguments. The env/clock/rng bans are
mechanically enforceable - see the `mechanical-enforcement` skill's purity rules.

Wire dependencies in one composition root in the bootstrap/entrypoint and pass
them inward as explicit arguments. That single wiring point is also the one place
to substitute every dependency with a fake in tests, which beats patching
imports. Passing the container or a global registry inward so code resolves its
own dependencies is service location: the signature stops being the honest
list, and a wiring mistake becomes a run-time surprise. When a type's explicit
dependency list grows past three or four, treat it as a design signal, not a
wiring problem - the type is doing too much, or several of those dependencies
want to be one.

A port can be a plain function for a single-method dependency - reserve a
richer interface for a genuinely multi-method one. Reach for manual injection
once you have more than one adapter, and hand-wire the graph in one composition
root by default (pure DI) - one root per process, however deep the graph: depth
is not the trigger, and hand-wiring keeps a wrong graph a compile error. A
container is optional tooling: it earns its keep when convention-based
registration beats writing the wiring out, or when scoped lifetimes and disposal
ordering need managing - and it trades compile-time verification for run-time
resolution errors. Keep every reference to it inside the composition root.
