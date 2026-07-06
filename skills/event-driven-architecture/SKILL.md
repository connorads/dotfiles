---
name: event-driven-architecture
description: >
  Design messaging across service and process boundaries - when to go async,
  how events propagate between contexts, reliable publication (outbox/inbox,
  dual-write), delivery semantics (at-least-once, idempotent consumers, DLQ,
  ordering), and event/schema versioning. Use when work crosses a service
  boundary with queues, brokers, or streams (Kafka/RabbitMQ/SQS), integration
  events, or an evolving event schema.
---

# Event-Driven Architecture

This begins where a domain event leaves the process. The `architecture` skill
owns the inside of a bounded context - returning events as values, one
aggregate per transaction. This owns the wire: what happens once an event
crosses a process or service boundary and someone you don't deploy with
consumes it.

The move across that boundary is heavy and rarely the default. Reach for it
when the coupling genuinely warrants it, not because events feel scalable.

## Decision Tree

```text
Does this cross a process/service boundary?
|-- No -> stay in-process; return events as values, dispatch in the same
|         transaction. You do not need any of this. (see `architecture`)
|-- Yes, and the caller needs the answer now
|   `-- synchronous request/response. A queue here only adds latency and
|       failure modes. Async is not a resilience upgrade by default.
`-- Yes, and the work can happen after the fact
    `-- async messaging. Now these bite, roughly in order:
        |-- how does the event leave the context?   -> references/event-propagation.md
        |-- how is it published without being lost?  -> references/reliable-publication.md
        |-- what happens on redelivery or failure?   -> references/delivery-semantics.md
        |-- how does it change over time?            -> references/schema-versioning.md
        `-- who coordinates a multi-step flow?       -> references/topology.md
```

## When To Go Async At All

Default to synchronous request/response. Reach for a queue or broker only to
buy one of four things, and name which:

- **temporal decoupling** - producer and consumer need not be up at once
- **load levelling** - absorb spikes, consume at a steady rate
- **fan-out** - many independent consumers react to one fact
- **long-running work** - the caller must not block on it

If none of these is the reason, a direct call is simpler and easier to reason
about. "Might need to scale later" is a reason to keep the boundary clean, not
to add a broker now.

## The Distinctions That Bite

Each of these is routinely blurred, and each blur is a production bug waiting to
happen. Hold them as explicit pairs.

- **Domain event vs integration event** - a rich in-process fact vs a
  serialisable thing another service consumes. Whether they are one type or two
  is a genuine design choice, not a rule - see `references/event-propagation.md`.
- **Event notification vs event-carried state transfer vs event sourcing** -
  three of Fowler's four (CQRS being the fourth, and arguably not about events),
  orthogonal. Thin "it happened, call back" vs fat "here is the new state, keep
  your own copy" vs "the log is the source of truth." You can do any without the
  others; conflating them makes consistency bugs undiagnosable.
- **At-least-once delivery vs exactly-once processing** - exactly-once
  *delivery* end-to-end is not achievable; you engineer **effectively-once** by
  pairing at-least-once delivery with an idempotent consumer. "Exactly-once
  *processing*" (Kafka's EOS term) is a real, defended term, not a myth -
  "effectively-once" is a synonym for it, not a correction. Kafka EOS and SQS
  FIFO hold only inside their own boundary - a write to an external DB or API
  still needs your own idempotency or an outbox.
- **Additive vs breaking schema change** - adding an optional/defaulted field is
  safe and evolves in place; removing, renaming, retyping, or *re-meaning* a
  field is breaking and needs a new version, type, or topic. The subtlest
  breaking change is a semantic one under the same name and type - no registry
  catches it.
- **Choreography vs orchestration** - no central coordinator (emergent,
  decoupled, hard to observe end-to-end) vs a process manager issuing commands
  (explicit, debuggable, a coupling point that can rot into a god-service).
  Trust vs control - see `references/topology.md`.
- **Queue vs log** - a transient competing-consumer queue (RabbitMQ/SQS: max
  parallelism, no replay, ordering lost under competing consumers) vs a retained
  partitioned log (Kafka: replay, per-key order, but parallelism capped at
  partitions and one slow message blocks its partition). You cannot have
  unbounded per-key ordering *and* unbounded fan-out parallelism.

## Two Things That Always Hold

Everything above is a choice with trade-offs. These two are not:

- **Never serialise a live aggregate onto the wire.** The wire payload is its
  own type - an event contract, versioned - not your domain object leaking its
  shape to every consumer.
- **Anything that crosses a service boundary is a public contract.** Treat an
  integration event like a published API: independent consumers, versioned,
  evolved by the rules in `references/schema-versioning.md`. Inside your own
  process you can refactor freely; across the boundary you cannot.

## Reaching Out

- Consumer-driven contract testing (e.g. Pact) - see the `testing` skill.
- Parsing the wire payload back into a trusted domain type at the boundary -
  parse-don't-validate, see `architecture` / `typescript`.
- End-to-end observability across the async hops this skill keeps flagging ("where
  is order 123 stuck?"): propagate **W3C Trace Context** (`traceparent` /
  `tracestate`) in message headers so one trace spans producer -> broker ->
  consumer, and prefer OTel span **links** over parent-child (a consumer may
  process minutes later, so nesting distorts trace duration). Adopt the OTel
  messaging semantic conventions (`messaging.system`, `messaging.destination.name`,
  PRODUCER/CONSUMER span kinds). The structured-log and correlation-ID foundation
  is the `architecture` skill's Observability section.
