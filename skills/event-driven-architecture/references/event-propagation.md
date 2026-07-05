# How Events Cross A Boundary

There is no single right answer to "domain events vs integration events." The
field genuinely disagrees, and three shipping teams can make three different
choices that all work. So this is a menu, not a mandate. Decide per context.

## It Is Four Choices, Not One

"Domain vs integration event" is usually presented as one decision. It is
really four independent axes - you can mix them freely, and real systems do:

1. **How many event types?** One event that serves both in-context handlers and
   cross-boundary consumers, vs two distinct types with an explicit translation
   between them.
2. **When are they raised?** One at a time, as each fact occurs, vs accumulated
   on the aggregate/entity and flushed together at the end of the operation.
3. **When are they dispatched?** Before commit (side effects atomic with the
   write) vs after commit (eventual, needs compensation if a handler fails).
4. **What actually crosses the boundary?** The same event serialised as-is, vs a
   translated, versioned public contract shaped for outside consumers.

Naming the axis you're deciding stops the argument. "Should we use integration
events?" is four questions wearing one coat.

## Stances People Actually Ship

- **A. One event type, raised as it happens.** The same domain event is what
  crosses the boundary. Simple, less ceremony, fewer types to keep in sync. The
  cost: your internal event shape *is* your public contract, so refactoring it
  can break a consumer. (Vernon's IDDD notification log; Wlaschin's Domain
  Modelling Made Functional treats the event as one type distinguished only by
  whether it leaves the context.)
- **B. Two tiers - domain event in-process, separate integration event out.**
  The integration event is produced by a handler on the domain event, not raised
  by the aggregate, and published after commit. More types and mapping, but the
  public contract is decoupled from the internal model and can evolve on its own
  clock. (Microsoft/.NET eShop; the two-tier camp.)
- **C. Aggregate collects events, flush on save.** The entity records events
  internally as its methods run, and the infrastructure dispatches them when the
  unit of work commits. Orthogonal to A vs B - it's a *when-raised* choice that
  pairs with either. (Bogard's deferred dispatch; how event-sourced aggregates
  append-then-publish.)

Mixing is normal: two-tier types (B) with aggregate-collected dispatch (C) is a
common, coherent combination. So is one-type (A) raised one at a time.

## Trade-offs, Not A Verdict

| Choice | Buys you | Costs you |
|--------|----------|-----------|
| One type (A) | less code, fewer types in sync | internal shape leaks as public contract |
| Two tiers (B) | contract evolves independently of the model | more types + mapping to maintain |
| Raise as-it-happens | simple, immediate | no natural batch/transaction framing |
| Collect + flush (C) | one dispatch point, testable, txn-aligned | events "in flight" on the entity until save |
| Before commit | side effects atomic with the write | a slow/failing handler holds the transaction |
| After commit | write commits fast, handlers independent | eventual; a failed handler needs compensation |

Pick by how much the consumers are outside your control and how independently
the contract must evolve. The more consumers you don't deploy with, the more a
separate, versioned contract (B) earns its keep.

## The Two That Don't Bend

Whatever you choose above:

- **Don't serialise a live aggregate onto the wire.** The moment an event leaves
  the process it needs its own payload type. Otherwise every consumer couples to
  your internal model and you can't refactor it.
- **What crosses the boundary is a versioned public contract.** Evolve it by the
  rules in `schema-versioning.md`, not by editing the shape and redeploying.

## Payload: Thin Or Fat

Independent of the above - how much state does the event carry?

- **Thin / notification** - "OrderPlaced, id=123." Consumers call back for
  detail. Small, loosely coupled, but chatty and prone to staleness between the
  event and the callback.
- **Fat / event-carried state transfer** - the event carries the fields
  consumers need, so they keep a local replica and never call back. Autonomous
  consumers, no callback traffic, but a bigger contract and duplicated data.

Thin when consumers rarely need the detail or the data is sensitive; fat when
consumers must keep working while you're down. This is the notification-vs-ECST
distinction from the spine - decide it per event, not per system.
