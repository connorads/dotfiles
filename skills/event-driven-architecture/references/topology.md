# Who Coordinates The Flow

A multi-step process spanning services - place order, take payment, reserve
stock, ship - has to be coordinated somehow. Two topologies, and a taxonomy
people constantly conflate.

## Choreography vs Orchestration

- **Choreography** - no central coordinator. Each service reacts to events and
  emits its own; the flow is emergent. Services stay decoupled and autonomous,
  and adding a step can be as cheap as adding a subscriber. The cost: no one
  place describes the whole process, so reasoning about it end-to-end and
  debugging a stuck flow is hard, and a cyclic chain of reactions can hide.
- **Orchestration** - a **process manager** (orchestrator) owns the flow and
  issues commands to each service, reacting to their replies. The process is
  explicit, observable, and debuggable in one place. The cost: the orchestrator
  is a coupling point that can accrete logic and rot into a god-service every
  step depends on.

Newman's framing: **trust vs control.** Choreography trusts each service to play
its part; orchestration keeps control in one place. Prefer choreography for loose
coupling between a few reactions; reach for orchestration when the flow is long,
has real branching, needs compensation, or someone must be able to answer "where
is order 123 stuck?" - which is most business-critical processes.

## Sagas: Consistency Without A Distributed Transaction

A **saga** is how a multi-service flow stays consistent without a distributed
transaction: a sequence of local transactions, each publishing an event or
command that triggers the next, with a **compensating action** to undo each step
if a later one fails. It can be run either way - choreographed (each service
listens and reacts) or orchestrated (a process manager drives it).

The catch to hold in mind: a saga gives you **ACD, not ACID** - it drops
*Isolation*. Intermediate states are visible to the rest of the system before the
saga completes, so another actor can see a half-done process (an order that's
placed but not yet paid). Design explicit countermeasures - semantic locks, a
`pending` status, re-reads - rather than assuming isolation you don't have. This
is the concrete shape of the `architecture` skill's "eventual consistency must
still converge."

## Fowler's Four Are Orthogonal

The most common source of muddled EDA arguments. These are four distinct
patterns, freely combinable, not a ladder:

- **Event notification** - "something happened," thin, consumer calls back for
  detail. Lowest coupling, no shared data.
- **Event-carried state transfer (ECST)** - the event carries the state, so
  consumers keep a local replica and don't call back. Autonomy at the cost of
  duplicated data.
- **Event sourcing** - the event log *is* the source of truth; current state is a
  fold over events. Full audit and replay; heavy, and versioning gets hard (see
  `schema-versioning.md`).
- **CQRS** - separate the write model from the read model. Often paired with
  events but independent of them.

You can do notification without sourcing, sourcing without CQRS, CQRS without
either. Say which one you mean; "we're doing event-driven" names none of them,
and conflating them is how a team ends up debugging a consistency bug they can't
locate.

## In-Process Read Model vs Cross-Service ECST

Easy to conflate, genuinely different. A CQRS read model kept fresh from *your
own* domain events, inside your service, is a local projection - the
`architecture` skill's "Reads and Writes." A *consumer in another service*
keeping its own copy from *your published* events is ECST - a cross-boundary
replica coupled to your event contract, and versioned like one. Same mechanism,
different blast radius. Know which side of the boundary you're on.

## Request-Driven vs Event-Driven Is Per Interaction

Not a whole-system flag. A single service can serve a synchronous query on one
path and react to events on another. Choose per interaction by the rule in the
spine: synchronous when the caller needs the answer now; event-driven to buy
temporal decoupling, load levelling, fan-out, or long-running work. Don't
event-source the login flow because the orders context benefits from events.
