# Evolving An Event Over Time

A published event is a public API. Independent consumers you don't deploy with
depend on its shape, so you evolve it under the same discipline as any public
contract - not by editing the shape and redeploying.

## Additive Is Safe, Breaking Is Not

- **Additive (safe, evolve in place)** - add a new *optional* field, or one with
  a default. Old consumers ignore what they don't know; new consumers read the
  new field when present. No new version needed.
- **Breaking (needs a new version)** - remove a field, rename it, change its
  type, make an optional field required, or *change what it means* while keeping
  its name and type. Each breaks a consumer that trusted the old shape.

The subtlest and most dangerous is the **semantic** change: `amount` was net, now
it's gross; `status` gained a value old consumers don't handle. The wire shape is
identical, so no schema registry, type checker, or test catches it. A semantic
change is a breaking change - version it like one.

## Compatibility Has A Direction

Compatibility is defined by *who reads whom*:

- **Backward compatible** - new consumer code can read data written by old
  producers. (Add optional fields; consumers upgrade first.)
- **Forward compatible** - old consumer code can read data written by new
  producers. (Consumers must ignore unknown fields; producers upgrade first.)
- **Full** - both. The safe default for events with many independent consumers.

Which you need dictates **deploy ordering**. Backward-only: upgrade consumers
before producers. Forward-only: producers first. Get the order wrong and a
"compatible" change still breaks in production. A schema registry (e.g. Confluent)
can enforce a chosen mode - including *transitive* checks against all prior
versions, not just the last.

## Tolerant Reader

Consumers should be liberal in what they accept: **ignore unknown fields**,
don't fail on extra data, read only what they need. This is what makes additive
producer changes safe.

The nuance - and it is contested - is that Postel's "be liberal in what you
accept" taken too far hides divergent interpretations and accrues interop debt.
Martin Thomson's IETF draft *The Harmful Consequences of the Robustness Principle*
(`draft-thomson-postel-was-wrong`) makes the case directly: liberal acceptance
causes long-term *protocol decay* as divergent interpretations accrete, so it
argues for active maintenance over blanket tolerance. Draw the line at *structure
vs meaning*: be liberal about unknown or extra fields, strict about ambiguous or
malformed *core* data you actually consume. Tolerate what you ignore; validate what
you use.

## Handling A Breaking Change

You cannot rewrite history for consumers that already read the old shape. Three
moves, roughly in order of reach:

- **Parallel change (expand/contract)** - publish both old and new shapes for a
  window; migrate consumers; then retire the old. The standard, lowest-drama
  path for a live stream.
- **New event version or type** - `OrderPlacedV2`, or a new topic. Consumers opt
  in when ready. Reach for this when old and new can't coexist in one payload.
- **Upcasting (event-sourced stores)** - when the log *is* your source of truth
  you can never delete an old event shape; you transform old events to the
  current shape on read (an upcaster / copy-transform), or store with a weak
  schema you map rather than deserialise strictly.

Greg Young's rule for event sourcing generalises well: if you can't convert the
old event into the new one by a pure function, it isn't a new *version* - it's a
new *event*. Give it a new name rather than pretending it's the same fact.

The same rule reaches durable-execution engines: a workflow's execution history
*is* an event-sourced log, so editing workflow code can break deterministic replay
of in-flight runs (Temporal's "non-deterministic error"). The fix is the direct
analogue of upcasting - version the code path (`patched` / `GetVersion`) so old
runs replay on the old branch. This is a footnote, not another instance of the
rules above: the history is engine-internal, not a published contract.

## Immutable Logs vs The Right To Be Forgotten

An append-only log's great virtue collides with GDPR Article 17 / CCPA: you cannot
surgically delete one subject's record from a Kafka topic or an event-sourced store
without breaking offsets and the fold. The standard answer is **crypto-shredding** -
encrypt each subject's PII under a per-subject key, then destroy the key on erasure
so the ciphertext becomes unrecoverable noise while the log's structure and offsets
stay intact. Pair it with tokenisation and a user-deletions topic to cascade the
erasure to downstream **ECST replicas** (your own event-carried state transfer has
already spread that PII into other services). Real costs: per-key KMS overhead,
on-the-fly crypto, and it is a defensible interpretation, not a guaranteed legal
safe harbour. Read "the log is immutable" as "never rewrite an event's *shape*",
not "PII lives forever" - and get the erasure design reviewed by legal.

## Format Choice Shapes Evolution

- **Avro** - schema travels with the data (or via a registry); strong,
  registry-checked compatibility rules. Heavier tooling; the usual pick for
  Kafka-scale streams.
- **Protobuf** - field numbers, not names, are the contract; add fields freely,
  never reuse a retired number. Compact, fast, good cross-language support.
- **JSON (Schema)** - human-readable, ubiquitous, weakest guarantees; evolution
  discipline is on you (and optionally JSON Schema + a registry).

None removes the need for the rules above; they only change how much the tooling
enforces for you.

## Verify The Contract

Additive-vs-breaking is a claim you should *test*, not assert. Consumer-driven
contract tests (e.g. Pact) let each consumer pin the shape it depends on so a
producer change that breaks it fails in CI, not in production - see the `testing`
skill.
