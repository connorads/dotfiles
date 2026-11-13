---
name: feynman
description: Write and check Feynman specs, which are small executable models of how part of a system behaves (actors, messages, timers, properties, scenarios) tied to the code by sources. The feynman CLI derives a playground, flows, model checking and diffs from them. Use to explain how a feature works, to review how a change affects behaviour, or to design a feature before or while building it.
---

# Feynman specs

A spec is a TypeScript file that models one behaviour of a system as a deterministic,
discrete-event program. You write the spec. The `feynman` CLI derives everything else
from it:

- a playground to try it in;
- the flows of every scenario;
- a bounded model checker for its properties, safety and liveness;
- diffs between commits;
- links from every step to the code.

**Never write a standalone UI for an explainer.** When the derived playground cannot show
what matters in the domain (a terminal to type in, a Settings pane), add a small
playground file beside the spec that composes Feynman's kit; see "Playground files".

## Setup

<!-- LOCAL PATCH (connorads dotfiles): Use the repository package manager and an installed Feynman CLI; prevent task-time package-runner downloads. -->

Feynman requires Bun 1.3 or later. Check `bun --version` before using it.
Use the repository's package manager to add `@leostera/feynman` as a development
dependency. Use Bun for package management only where the repository already does.
Run the installed CLI through the repository's package runner, such as
`pnpm exec feynman list` or `bun run feynman list`. Do not download a CLI at task time.

Specs import `@leostera/feynman` (the DSL) and playground files
`@leostera/feynman/play`. The editor's `tsconfig.json` needs
`"moduleResolution": "bundler"` and `"allowImportingTsExtensions": true`.
The upstream skill is at https://feynman.leostera.dev/SKILL.md.
## When to write one, and how big

- **Explain:** one spec per behaviour a newcomer would ask about, such as "how does a Mac
  get linked to an account?" Do not write one spec per service.
- **Review:** extend or adjust the spec that covers the change. `feynman diff` shows what
  changed in each scenario.
- **Develop:** write the spec first, check it, then write code that matches it. A spec
  needs no code: leave `sources` out of steps that are not built yet, and `feynman check`
  says which those are. The checker finds design flaws before there is anything to
  debug. Add `sources` to each step as its code appears; a source that is given must
  point at real code.

A spec models **this** system, not a kind of system. Someone who knows the code should be
able to point at every actor, message and step and say where it is.

- **An actor is something that runs separately or keeps its own state:** a process, a
  service, an external API, a database you do not own, a person, a device. Never merge two
  of them into one actor, and never split one process into several actors.
- **Calls inside one process are steps, not messages.** If `pipeline.py` calls download,
  then transcribe, then analyze, those are three steps of one actor, each with its own
  `sources`, chained with a `when` guard on the state (it runs as soon as it holds). A
  message means something crosses a process or network boundary.
- **One step per stage the code has.** A step whose sources span several functions in
  several files is hiding the system; split it.
- **Name instances the way people do:** "Studio" and "Alice", not "mac-studio". Use
  labels, not ids, in `status`, rows and `say` (ids in them are shown as labels anyway).
  When one machine runs two processes that are separate actors (an app and its daemon),
  give each a distinct label with a common prefix ("Studio app", "Studio daemon") and
  show them as one Mac with `defineGroup` (below).
- **Use the system's own words** for actors, messages, steps, statuses, files and tables:
  `READY`, `analysis.json`, "Pending folder". Don't invent generic roles such as
  "processor", "pipeline" or "store" unless the code uses them. Keep names short; put the
  tool list ("yt-dlp / Instaloader") in `description` or `display.status`, not the name.
- **Scope follows the request.** "The whole pipeline" means all of it. If that is too much
  for one spec, write several specs, one per behaviour. Never compress it into fewer,
  vaguer steps.
- **More specs, not bigger ones.** When a new behaviour comes up (a race, a recovery path,
  a second flow through the same actors), write a new spec for it rather than growing an
  existing one. Each spec stays small enough to explore exhaustively, and its
  counterexamples stay short enough to read. Actors may appear in several specs.

What to leave out: logging, metrics, retries the user can't observe. Leave state out only
if it never decides what happens next.

Before you finish, go through the spec once more. For each actor, message and step, ask:
"Could someone who knows this code point at it?" Rename or split anything that fails.

## Workflow

1. **Read the code first.** Find:
   - the actors: processes, services, people, devices (what runs separately);
   - the stages inside each process, in the order the code runs them;
   - what each one stores;
   - what each one sends, and when;
   - the timeouts and limits.

   Note the exact `path#symbol` for every step.
2. **Write `specs/<behaviour>.ts`** next to the package's `package.json` (the repository
   root counts).
3. Run `feynman check <behaviour>`. It does three things:
   - type-checks the spec;
   - runs every scenario;
   - explores every interleaving within bounds, then checks the properties and that every
     source resolves.

   Fix what it reports. "Stands for N pieces of code in M files" means one step is
   hiding several stages: split it. "Never ran" means no scenario or explored path
   reached those steps, so nothing about them was tested.
4. **When a counterexample appears**, read it (`feynman check <behaviour> --only <property>`)
   and sort it into one of three:
   - **A spec mistake:** the model does something the code does not. Fix the model.
   - **Intended behaviour:** the code means to do this, and the invariant asked for too
     much. Rewrite the invariant to state what the code does guarantee, and show the
     behaviour in a scenario whose description says it is intended.
   - **A finding:** the code really does this, and should not. Do not weaken the invariant
     to make it go away; report it.

   Then judge how likely a finding is before anyone writes tests or files issues. Check
   says how many faults each counterexample needs (it searches again with fewer, so "needs
   no faults" means it happens in normal operation, without a lost message or a crash).
   One fault on a rare path is a different finding from a plain delete-then-create. When
   you can reach production evidence (logs, error tracking, metrics), look for whether it
   happens, and say what you found; keep only findings with evidence or a severe outcome.
   A finding that stays until it is fixed gets `known: "why, or the issue"` on its
   property: check still reports it, but no longer fails on it.

   When a fix or a safeguard is the reason a property holds, make it a **rule**: name it
   with `defineRule`, read `rule.on` where it applies, and put `needs: [rule]` on the
   properties it protects. Check then also checks the design without the rule and expects
   each of them to break (`✓ rule  needed: without it, P breaks (5 events)`). A `✗` means the
   rule does nothing, or the property is too weak to see what it prevents: both are worth
   knowing. `feynman check <spec> --without rule` shows the design without it, with its
   counterexamples. Never copy a spec to flip a flag: that is what rules are for.
5. Run `feynman run <behaviour>` to read the traces of the scenarios as text.
6. Once the spec is right, run `feynman lock`. It records the code each source stands
   for, so later checks flag sources whose code changed.
7. Optionally, run `feynman dev` (or `build`/`open`) to open the explorer. Use
   `--base main` to compare with a branch.

**Do not commit unless asked.**

## The DSL

A spec is made of parts, each a value: messages, zones, actors, rules, properties and
scenarios. Define each at the top level of the file, then put them together with
`defineSpec`. Parts refer to each other by value, never by a string, so the editor and the
checker follow every reference.

```ts
import { atMost, budget, crash, defineActor, defineLimit, defineMessage, defineProperty, defineRule, defineScenario, defineSpec, defineZone, input, lose, oneOf } from "@leostera/feynman";

// Faults are steps the spec declares, from the faults library: here, at most one on any path.
// `--set faults=2` raises it.
const faults = budget("faults", 1);

// Messages: an id (a word, as the code names it) and the schema of the payload. The payload's
// type comes from the schema, and every payload sent is checked against it.
// Schemas: String, Number, Boolean, nested objects, oneOf("a", "b"), listOf(S), setOf(S),
// recordOf(S), nullable(S), and type<T>() for a type the checker does not look inside.
const NewCode = defineMessage("NewCode", { account: String }, { name: "new pairing code", over: "https" });
const Code = defineMessage("Code", { code: String }, { name: "pairing code", over: "https", tone: "reply" });
const Redeem = defineMessage("Redeem", { code: String, host: String }, { over: "https" });
const Redeemed = defineMessage("Redeemed", { account: String }, { tone: "reply" });
const Refused = defineMessage("Refused", { status: oneOf(404) }, { tone: "refused" });

const devices = defineZone({ name: "People's devices", description: "signed in with Access" });
const cloud = defineZone({ name: "Cloudflare" });

// A number the code names. Specs have no clock: this documents the system, it does not run.
const codeLifetime = defineLimit({ name: "Pairing code lifetime", value: 10, unit: "minutes", sources: ["packages/api/src/pairing.ts#CODE_TTL"] });

// A rule of the design: a part that exists to keep properties true (RFD0010). Read
// singleUseCodes.on where it applies; properties that need it say needs: [singleUseCodes],
// and check expects them to break without it.
const singleUseCodes = defineRule("singleUseCodes", { description: "A code is marked used when it is redeemed." });

const Relay = defineActor({
  name: "Relay",
  description: "The Worker that issues and redeems pairing codes.",
  zone: cloud,
  singleton: true, // exactly one, present from the start
  initialState: () => ({ codes: {} as Record<string, { account: string; used: boolean }> }),
  // How it is drawn in the playground: an icon, a status, and its state as rows.
  display: {
    icon: "cloud",
    status: (s) => `${Object.values(s.codes).filter((c) => !c.used).length} code(s) waiting`,
    // `owner` names the person a row belongs to, so the account box wears their colour.
    rows: (s) => Object.values(s.codes).map((c) => ({ group: `${c.account}'s account`, owner: c.account.replace(/^acct-/, ""), label: "pairing code", detail: c.used ? "used" : "unused", mood: c.used ? "off" : "info" })),
  },
  // Steps, by name. A step `on` a message runs when it is delivered: msg is that message's payload.
  transitions: {
    newCode: {
      on: NewCode,
      description: "Issues a one-time code for the account.",
      sources: ["packages/api/src/routes/pairing.ts#createPairing"],
      sends: [Code],
      // The timeline's sentence for this event, from the state after it.
      say: (_s, msg) => `Made a code for ${msg.account}, valid 10 minutes; only its hash is kept`,
      run(state, msg, ctx) {
        const code = ctx.fresh("code");
        state.codes[ctx.hash(code)] = { account: msg.account, used: false };
        ctx.reply(Code, { code });
      },
    },
    redeem: {
      on: Redeem,
      description: "Checks the code and, if valid, links the Mac.",
      sources: ["packages/api/src/routes/pairing.ts#redeemPairing", "packages/api/src/pairing.ts:31-58"],
      sends: [Redeemed, Refused],
      run(state, msg, ctx) {
        const entry = state.codes[ctx.hash(msg.code)];
        if (!entry || entry.used) return ctx.reply(Refused, { status: 404 }, "Unknown or used.");
        if (singleUseCodes.on) entry.used = true;
        ctx.reply(Redeemed, { account: entry.account });
      },
    },
    // Faults: the network may lose a Redeem on its way here, and the relay may crash and come
    // back with what it keeps in its database. Both spend the budget, and neither is fair.
    redeemLost: lose(Redeem, { spend: faults }),
    crash: crash({ keeps: ["codes"], spend: faults }),
  },
});

const Person = defineActor({
  name: "Person",
  zone: devices,
  initialState: (ctx) => ({ account: `acct-${ctx.label}`, codes: [] as string[] }),
  display: {
    icon: "phone",
    names: ["Alice", "Bob"], // labels for people added in the playground
    status: (s) => (s.codes.length ? `code ${s.codes.at(-1)}` : "signed in"),
    // The code on screen, to drag onto a Mac (see `accepts` on the Mac's `link` input).
    tokens: (s) => s.codes.slice(-1).map((code) => ({ kind: "pairing code", value: code })),
  },
  // Actions: what a person (or the outside world) can do. They are buttons in the playground,
  // and the checker tries them in every order.
  actions: {
    pair: {
      with: [atMost(2)], // a person may pair forever; the checker tries it at most twice per path
      label: "Pair a Mac",
      description: "Asks the relay for a code to type on a Mac.",
      sources: ["apps/web/src/pair.tsx#createCode"],
      sends: [NewCode],
      run: (state, _inputs, ctx) => ctx.send(ctx.the(Relay), NewCode, { account: state.account }),
    },
  },
  transitions: {
    code: { on: Code, description: "Shows the code.", sources: ["apps/web/src/pair.tsx#showCode"], run: (s, msg) => void s.codes.push(msg.code) },
  },
});

const Mac = defineActor({
  name: "Mac",
  zone: devices,
  initialState: () => ({ account: null as string | null, pending: null as string | null }),
  display: {
    icon: "laptop",
    status: (s) => (s.account ? "linked" : s.pending ? "linking" : "not linked"),
    mood: (s) => (s.account ? "ok" : s.pending ? "busy" : "off"),
    // Whose Mac this is, once linked: it wears that person's colour.
    owner: (s) => s.account?.replace(/^acct-/, "") ?? null,
  },
  // The live connections it holds, drawn as lines; `to` is an instance id or label, or a singleton's name.
  links: (s) => (s.pending ? [{ to: "Relay", kind: "https", style: "dotted" }] : []),
  actions: {
    link: {
      with: [atMost(2)],
      label: "Paste a pairing code",
      description: "Links this Mac to the account that issued the code.",
      // Inputs have a type; examples are what the playground offers and the checker tries:
      // a list, or a function of the world. Give such functions a return type when they
      // name another actor (see "Types" below).
      inputs: { code: input(String, { examples: (w): string[] => [...w.all(Person).flatMap((p) => p.state.codes), "never-issued"], accepts: "pairing code" }) },
      when: (s) => s.account === null, // offered only while this holds
      sources: ["apps/macos/RemoteAccess.swift#RemoteAccess.link"],
      sends: [Redeem],
      starts: ["redeemTimeout"],
      run(state, { code }, ctx) {
        state.pending = code;
        ctx.send(ctx.the(Relay), Redeem, { code, host: ctx.id });
        ctx.start("redeemTimeout"); // may fire at any moment from now on
      },
    },
  },
  transitions: {
    redeemed: {
      on: Redeemed,
      description: "The Mac is linked.",
      sources: ["crates/axod/src/pairing.rs#finish"],
      run(state, msg, ctx) {
        state.account = msg.account;
        state.pending = null;
        ctx.cancel("redeemTimeout");
      },
    },
    refused: { on: Refused, description: "Stays unlinked.", sources: ["crates/axod/src/pairing.rs#refused"], run: (s, _msg, ctx) => ((s.pending = null), ctx.cancel("redeemTimeout")) },
    // A step on no message: a timer (`after`, set with ctx.start) or a guarded step (`when`,
    // runs whenever it holds). It receives nothing: its run is (state, _, ctx).
    redeemTimeout: {
      description: "No answer in time; gives up.",
      after: "5 seconds", // when the code fires it, for readers; it may fire at any moment
      sources: ["crates/axod/src/pairing.rs#timeout"],
      run: (s) => void (s.pending = null),
    },
  },
});

// always: holds in every state.
const codesAreHashed = defineProperty("codesAreHashed", { description: "The relay stores only hashes of codes.", always: (w) => Object.keys(w.the(Relay).state.codes).every((k) => k.startsWith("hash:")) });
// everyStep: holds of every step (the worlds before and after it, and the event).
const codesOnlyShrink = defineProperty("codesOnlyShrink", {
  description: "Only issuing a code adds one.",
  everyStep: (before, after, e) => e.is(Relay, "newCode") || Object.keys(after.the(Relay).state.codes).length <= Object.keys(before.the(Relay).state.codes).length,
});
// leadsTo: whenever the first holds, the second holds then or later, in every fair behaviour.
// Also: eventually (holds at some point), infinitelyOften, eventuallyAlways (holds from some point on).
const pendingResolves = defineProperty("pendingResolves", {
  description: "A Mac waiting for an answer gets one.",
  leadsTo: { whenever: (w) => w.all(Mac).some((m) => m.state.pending !== null), then: (w) => w.all(Mac).every((m) => m.state.pending === null) },
});
// never: no trace has this shape. needs: the rules this property depends on; check expects
// it to break without each.
const redeemedOnce = defineProperty("redeemedOnce", {
  description: "A code is never redeemed twice.",
  never: (t) => t.count((e) => e.replied(Redeemed)) > t.count((e) => e.is(Person, "pair")),
  needs: [singleUseCodes],
});
// known: "RELAY-12: expiry is not enforced yet" marks a bug found and not fixed yet. Check
// reports it without failing, and fails once it holds.

// Scenarios: the flows a reader should see, scripted. Each becomes a flow and a playground start.
const linkAMac = defineScenario("Link a Mac", {
  description: "The happy path: a person pairs, the Mac redeems the code.",
  run(s) {
    const alice = s.spawn(Person, "Alice");
    const studio = s.spawn(Mac, "Studio");
    s.act(alice, "pair");
    s.settle(); // left alone: messages in send order, then, when none is in flight, timers
    s.act(studio, "link", { code: alice.state.codes[0] });
    s.settle();
    // One step at a time, in any order: s.deliver(relay, Redeem) delivers a message in
    // flight now, s.fire(studio, "redeemTimeout") fires a timer, and s.step(who, "name")
    // takes any step by name: a guarded step, or a fault, s.step(relay, "redeemLost") to lose
    // a Redeem in flight and s.step(relay, "crash") to crash the relay.
    // s.settle({ until: (w) => … }) runs left alone only until the world gets there, to
    // step in at that moment (a crash, a loss) without delivering each message by hand.
    // s.the(Actor) reaches singletons; s.world reads the whole world.
  },
});

// The spec: its parts, put together. Messages, zones and rules are found from the actors and
// properties that use them.
export default defineSpec({
  name: "Remote access",
  description: "How a Mac gets linked to an account with a one-time pairing code.",
  actors: [Relay, Person, Mac],
  limits: [codeLifetime],
  properties: [codesAreHashed, codesOnlyShrink, pendingResolves, redeemedOnce],
  scenarios: [linkAMac],
});
```

`defineSpec` says when the parts do not fit, before anything runs: two parts with one id, a
message sent that no actor has a step `on`, two fair steps on one message (the others say
`fair: false`), an actor named in a group that is not in `actors`. `feynman check` also warns of a step on a message no step sends: it never runs.

Several specs from one file (a buggy and a fixed variant) are a function of the variant
that defines the parts inside and returns `defineSpec(…)`, as in `examples/`. A helper used
by several steps takes `(state: State, ctx: Ctx)`, typed: `type State = ReturnType<…>` or
a named type for `initialState`.

### Rules the engine enforces

- **Determinism.** Handlers see the world only through `ctx`:
  - `id`, `label`;
  - `fresh(prefix)` for ids, `hash(value)` and `random()`;
  - `send`, `reply`, `start(label)` and `cancel(label)`;
  - `the(Actor)`/`all(Actor)` to find instances, and `note(text)`;
  - for steps that build faults: `delivery` (the message taken, and whom from),
    `forward()` (put it back in flight) and `reset({ keeps, drops })` (start again, as a
    crash does). The faults library is built on these; write your own the same way.

  Don't use `Date`, `Math.random`, `async`, I/O or module-level mutable state.
- **Mutate `state` in place.** The engine records each change as `path: before → after`.
  A `run` that returns a new state object, or is `async`, is a spec error.
- **Declare effects.** Every message a step sends must be listed in its `sends`, and every
  timer it starts in its `starts`. The types check most of this. An undeclared send at
  runtime is a spec error, and the step's effects are discarded. So is a payload its
  message's schema does not allow, such as `{ socket: "1" }` for `{ socket: Number }`.
- **Every message needs a handler.** A delivered message with no transition on the
  receiver is a spec error.
- **Write descriptions in everyday words**, one sentence, about what happens and not how
  the code does it. Use `ctx.note(text)` or the `text` argument of `send`/`reply` for what
  is specific to one event.

### Make the playground worth looking at

The playground is drawn from the spec, so the spec decides how good it looks. For every
actor, add:

- **`display.icon`.** One of `person`, `people`, `phone`, `laptop`, `desktop`, `browser`,
  `server`, `cloud`, `database`, `shield`, `key`, `lock`, `terminal`, `robot`, `queue`,
  `folder`, `file`, `sheet`, `globe`, `gear`, `camera`, `video`, `mail`, `bell`, `clock`,
  `cpu`, `box`, `plug`, `wifi`, `chat`, `router`, `storage`, `code`, `pipeline`, `eye` or
  `card`.
- **`display.status`:** a few words under the name, such as "connected", "not linked" or
  "3 jobs queued".
- **`display.mood`:** `ok`, `warn`, `bad`, `busy`, `off` or `info`, which colours the node.
- **`display.rows`** for state worth seeing as structure, such as a service's accounts and
  hosts, or a queue's jobs. Give each row a `label`, an optional `detail` and `mood`, and
  a `group` to box rows together. Use it on hubs (singletons); on other actors, keep it to
  one to three rows.
- **`links`** for connections that come and go: sockets, sessions, subscriptions. Only
  live links are drawn prominently.
- **`display.owner`:** whose this is, as an instance label or id: a Mac belongs to the person
  whose account it is linked to. It then wears that person's colour, so readers can
  follow Alice through the system.
- **`routine: true`** on housekeeping steps a reader need not watch, such as heartbeats,
  lease renewals or polling. The playground folds runs of them into one timeline line
  and does not stop for them; the checker explores them like any other step. Better
  still, leave out a heartbeat unless its expiry changes what happens.
- **`display.tokens`** for things a person would carry from one node to another: a pairing
  code shown on a phone, a link to share, a file to upload. Each is `{ kind, value, label? }`,
  and it floats beside the node. Give the receiving action's input `accepts: kind`, as in
  `input(String, { examples, accepts: "pairing code" })`. Dragging the token onto
  that node then runs the action with it. This is the most memorable way to show a
  hand-off between actors. Without any declared tokens, the playground infers them: a
  value an action's input examples read from another instance's state can be dragged
  from that instance. Declare tokens when you want control over what shows.
- **`row`** on a link: the label of the target's row it ends at. With it, a Mac's socket
  meets that Mac's line in the relay rather than the relay's icon.
- **`owner`** on a row: the instance it belongs to, by id or label. The row's group, and
  the row itself if it has no mood, take that instance's colour; links take their
  source's. Readers can then follow Alice through the system.
- **Zones for the parts of the system and its concerns**, not only for where code runs.
  A zone is a set of actors that work together on one concern and talk mostly among
  themselves: the people and their devices; the request path; the storage behind it; a
  cluster of replicas. "Local" and "cloud" alone put everything that matters in one box.
- **Zone `description`**: a few words beside its name, such as "sign in with Access".
- **Placement hints**, when the computed map does not tell the story; there are no
  coordinates.
  - On a zone, `place: { column, region, align, arrange }`:
    - `column` orders zones left to right, from 0;
    - `region: true` draws the zone as the tinted area everything hangs off (a zone holding
      a singleton is one by default);
    - `align` is `"start"`, `"center"` or `"end"`;
    - `arrange` is `"stack"`, `"row"`, `"grid"` or `"ring"`. Use a ring for peers in a
      cluster (replicas, nodes electing a leader), a grid for shards or for several distinct
      services that sit side by side, and a stack or row for a few things in a line.
  - On an actor, `place: { order, edge }`:
    - `order` sorts its instances within the zone;
    - `edge: "left" | "right"` sets it on the zone's border, like a gate everything passes
      through.
- **Groups**, for the level of abstraction a newcomer needs. Model each process as its
  own actor, as the checker needs, then say which read as one thing:
  ```ts
  // One relay for people, as the product presents it.
  const relay = defineGroup({ name: "Axo relay", actors: [Worker, Manager, Index], icon: "cloud" });
  // One Mac: "Studio app" and "Studio daemon" are one "Studio"; + adds both.
  const mac = defineGroup({ name: "Mac", actors: { app: App, daemon: Axod }, icon: "laptop", names: ["Studio", "iMac"] });
  // and in defineSpec: groups: [relay, mac]
  ```
  A list of singletons is one node. A record groups other actors' instances by label
  suffix. A closed group is one node: messages between its members don't fly across the
  map, and they fold in the timeline as "inside Axo relay". Readers open it with "Look
  inside". Groups start closed; pass `collapsed: false` to start open.
- **`display.names`**: labels for instances added in the playground, such as
  `["Alice", "Bob"]`, rather than "Person 2".
- **`display.shape`** only to override the default: services (cloud, server, database…) are
  circles with a short name inside, devices (phone, laptop…) rounded squares, and actors
  on a zone's edge gates.
- **`expires`** on a token, in simulated milliseconds: the ticket shows the time it has
  left. A token disappears from its holder once an action has taken its value as an
  input, so a used pairing code is gone from the phone.
- **`say`** on the steps a reader cares about. It is the sentence the timeline and the
  speech bubbles show, such as "Made code 19YP for alice, valid 10 minutes". Without it,
  they show the `description`.

These functions take only the actor's own state. Keep them cheap and total: a throw
shows nothing rather than an error.

Export the actors other files need (`export const Person = defineActor(…)`): a playground
file or a helper then imports them, typed, like any value.

### Playground files

Write `specs/<behaviour>.play.tsx` only when the defaults cannot show something the
reader must see to understand the domain. Examples: a terminal on the phone that has a Mac
open, with commands to click and their output; the status a group shows while closed
("1 code waiting"); a custom drawing for one node. The spec stays the model: the checker,
flows and diffs never load this file, and removing it leaves a working playground.

```tsx
import { definePlayground, Terminal } from "@leostera/feynman/play";
import spec, { Axod, Manager, Person } from "./remote-access.ts";

export default definePlayground(spec, (play) => {
  // A group's status while closed, from its members' state.
  play.group("Axo relay", {
    status: ({ member }) => {
      const waiting = Object.values(member(Manager)?.state.pairings ?? {}).filter((p) => !p.consumed && !p.expired).length;
      return waiting ? `${waiting} code(s) waiting` : "one room per account";
    },
  });
  // A panel beside a node while it returns something; act() runs one of its actions.
  play.actor(Person, {
    panel: ({ state, world, live, act }) => {
      const host = Object.keys(state.watching)[0];
      if (!host) return null;
      return (
        <Terminal
          title={world.all(Axod).find((a) => a.id === host)?.label ?? host}
          lines={state.asked.flatMap((r) => [`$ ${state.commands[r]}`, ...(state.outputs.includes(r) ? ["ok"] : [])])}
          commands={["whoami", "uptime"]}
          onRun={live ? (command) => act("run", { host, command }) : undefined}
        />
      );
    },
  });
});
```

- **What you can say:**
  - `play.group(name, actors?, { status, render, panel, size, icon, collapsed })` styles a
    spec group, or adds one when given actors;
  - `play.actor(Actor, { node, panel, size })` redraws a node or adds a panel;
  - `play.token(kind, render)` draws a token;
  - `play.link(kind, { style, flowing, color })` styles a kind of link.
- **Render functions only draw and act.** They receive typed `state`, `display` (the
  default, to build on), `world`, `live` and `act`. They change the model only
  through `act(action, inputs)`, which runs a declared action exactly as the playground's
  buttons do, and does nothing while the reader looks at the past (`live` is false).
  Keep them pure and cheap: they run on every frame while events play. If one throws, that
  node falls back to the default drawing.
- **Compose the kit:** `Node`, `Rows`, `Ticket`, `Terminal`, `Panel`, `Card`, `Badge`,
  and `Icon` from `@leostera/feynman/play`. They carry the playground's look in light
  and dark mode. For anything else, use the `style` prop with Kumo's CSS variables (such
  as `var(--color-kumo-line)`). Tailwind classes in a playground file are not compiled.
- **What the playground needs in the spec:** a panel can only show what the state holds.
  To show the command typed, the state must keep it; to strike out an expired code, the
  state must say it expired. Add such state only if it is true to the system, and keep the
  checker's result the same.
- `feynman check` type-checks the playground file with the spec and loads it, which
  catches actors and state fields that do not exist.

### Types

- Everything a spec needs comes from `"@leostera/feynman"`: the `define*` functions, the
  faults library (`budget`, `spend`, `atMost`, `lose`, `duplicate`, `crash`, `defineCall`,
  `failed`), `input`, and the schemas. For helpers, the types are `Actor`, `Instance`, `World`, `Ctx`, `Script`, `Display`,
  `Link`, `Row`, `Token`, `Icon`, `Mood`, `ZonePlace` and `ActorPlace`.
- **The source is the reference.** Feynman ships as TypeScript, so it is in
  `node_modules/@leostera/feynman/src`; read it when this page does not answer.
  `spec/dsl.ts` has the whole API with its doc comments (`SpecParts`, `ActorDef`, `StepDef`,
  `Script` for scenarios, `PropertyDef`, `ZonePlace`); `spec/engine.ts` and `spec/run.ts`
  say what a step and a scenario do; `examples/` has complete specs with their bugs.
- **Let inference work; don't annotate actors.** If tsc says an actor "implicitly has type
  'any' because it … is referenced directly or indirectly in its own initializer", two
  actors refer to each other inside a function whose return type TypeScript has to infer.
  This is usually input `examples`. Give that function a return type:
  `examples: (w): string[] => …`.
- To send to yourself, use `ctx.send(ctx.self, …)`. Avoid `ctx.the(ThisActor)`.
- **Actions without inputs** leave out `inputs`. Scenarios call them as `s.act(x, "pair")`.
- **Use one message per meaning.** If a refusal means different things in different
  places, declare different messages. Don't add a field to tell them apart.
- **States and payloads hold plain data**: strings, numbers, booleans, null, undefined,
  arrays, plain objects, `Set`s, `Map`s and dates. A function or class instance fails the
  step. Use a `Set` for a set (it is compared by its members, in any order) rather than an
  array you keep sorted: under symmetry, renamed ids would put the array out of order.

### Sources

`sources` is an ordered trail from the entry point inwards. Each entry is either:

- `path#symbol`, with `Outer.method` or `Outer::method` for methods, found by definition in
  TypeScript, JavaScript, Rust, Swift, Go, Python and more;
- `path:start-end`, when there is no symbol.

Paths are relative to the repository root. The first `path#symbol` of a step is the root
of its call tree in the explorer. Point each step at the function or method that does it
(`src/store.ts#Store.split`), not at the class around it: a class is every step at once, and
its call tree says nothing about this one.

**Point at real code; never invent paths.** `feynman check` fails on sources that don't
resolve. When the code does not exist yet, leave `sources` out of that step instead.

### Modelling choices

- **Instances.** Use `singleton: true` for things there is one of (a service, a database).
  For the rest, scenarios `spawn`, and the checker uses one of each, or more with
  `--instances Mac=2`. Two of an actor are cheap when you declare `symmetric: true` on it:
  the checker then treats "Alice, then Bob" and "Bob, then Alice" as one state. Declare it
  only when the spec compares the actor's ids and labels for equality and never orders or
  computes with them (electing the highest id, hashing an id). The checker tests the claim
  on up to `--symmetry-checks N` merged states (2000) and says when it is false; testing
  takes a large share of a symmetric search, so lower it for speed once the claim has held.
- **State.** Keep only what decides behaviour. Use hashes, not secrets (`ctx.hash`).
- **Repeats.** Bound each action a person could take forever with `with: [atMost(2)]`: each
  instance takes it at most twice on one path. Raise the number when a bug needs more; a
  variable shared by several actions (`defineVariable("repeats", 2)`, then `atMost(repeats)`)
  is raised with `--set repeats=3`.
- **Faults are steps the spec declares**, from the faults library; the checker imposes none.
  Declare a budget, `const faults = budget("faults", 1)`, and spend it from each fault, as
  steps in the actor that suffers it:
  - `lose(Message, { spend: faults })` on the receiver: the message is lost on the way. The
    sender hears nothing, as with a queue, a datagram or a stream.
  - `duplicate(Message, { spend: faults })`: the network delivers it twice.
  - `crash({ keeps: ["codes"], spend: faults })`: the instance starts again from its
    initial state, but for the fields in `keeps` (what it wrote to disk); its timers are gone.

  `--set faults=0` checks the system without faults, `--set faults=2` with two on a path.
  Declare the faults the system really has: a database that does not crash in the scope of
  the spec gets no `crash`. A **call** is a message whose failure reaches the caller, as an
  RPC, a `fetch` or a Durable Object stub throws: define it with `defineCall` instead of
  `defineMessage`. Losing it delivers its failure to the caller, handled by a step
  `on: failed(Call)`: `run(state, failure, ctx)`, with `failure.payload` and `failure.to`.
  Losing its reply fails it too, when the lost reply says so:
  `lose(Charged, { fails: Charge, spend: faults })`. The caller cannot tell which was lost,
  as the code cannot: a retry after a lost reply runs the call twice, so that is where to
  look for duplicates. A crash drops the failures on their way to the instance. A
  counterexample that ends with someone waiting on a lost message is the code having no
  answer for it (a finding), or the model missing the one it has (often: it is a call).
- **Time.** Specs have no clock: a run is an order of events, and anything pending may go
  next. A timer (`ctx.start(name)`) may fire at any moment until it fires or is cancelled,
  so "the retry fires before the reply arrives" is always possible, as it is in production.
  Say how long the code waits with `after: "5 seconds"` on the timer's transition and
  `defineLimit` for named values; they are for readers. An expiry is a timer that flips state
  (`expired = true`), never a stored time. When an ordering really depends on durations (a
  heartbeat always beats an expiry, on one machine), model it with state and say so; usually
  the counterexample is a real risk.
- **Scenarios** change the world through events in `run`: spawns, actions, deliveries,
  timers and steps, faults included. `s.world` and `s.the(X).state` are for reading. A scenario
  starts from the spec's start, where only the singletons exist, in their `initialState`,
  unless it has a `setup`. A scenario that begins after some history (a second push, a fetch
  after pushes) sets that world up rather than replaying it:

  ```ts
  const secondPush = defineScenario("Second push", {
    description: "Alice pushes again to a repository that has her first commit.",
    setup(w) {
      w.set(Ledger, { refs: { main: "c1" }, published: ["c1"] }); // a singleton: these fields over its initialState
      w.spawn(Git, "Alice", { head: "c1" });                       // there from the start, not spawned in the flow
    },
    run(s) {
      const alice = s.the(Git);
      s.act(alice, "commit");
      s.act(alice, "push");
      s.settle();
    },
  });
  ```

  The flow and the playground start after the setup. A setup is a claim that the system gets
  there: the checker explores from it too, and a property the world breaks is reported
  against the scenario ("its setup breaks …"). Set only instance states; messages in flight
  and timers come from events. Don't seed history in `initialState`: it applies to every
  scenario and every state the checker explores. To get to a moment and step in there,
  `s.settle({ until: (w) => w.the(R2).state.layers.length > 0 })` and then `s.step(r2, "crash")`,
  rather than delivering each message by hand.
- **Left alone.** `s.settle()` and the playground's Play run the system
  left alone: messages in the order they were sent, and when none is in flight, the timers
  that are set, oldest first, up to 200 events. So a scenario's `settle()` also fires
  timeouts and expiries once the network is quiet: act before settling if something must
  happen before a timer. `s.fire(who, "retry")` fires a timer early, ahead of what is in
  flight.
- **In the end.** `w.quiet` is true when nothing is in flight. "Once quiet, the nodes agree"
  is a safety property (`always: (w) => !w.quiet || …`), cheaper and sharper than liveness
  when what you mean is "after everything has arrived".
- **Never.** A `never` property sees the path through `trace.count` and `trace.some`; prefer
  those to reading `trace.events`, which makes every path its own state.
- **Liveness.** `eventually`, `leadsTo`, `infinitelyOften` and `eventuallyAlways` hold in
  every fair behaviour, as in TLA+. Fair: a message in flight is delivered, a timer that stays
  set fires, a guard that stays true runs (weak fairness; `fair: "strong"` on a step for steps
  that keep being possible on and off, `fair: false` for none). Actions and faults are never
  fair: a person may stop, the network may stop failing. A counterexample is a path and then
  a loop it repeats forever (or a world where nothing fair can happen). Liveness turns off
  symmetry, so it costs more states. If a loop could lie past the
  depth bound (the worlds never run out, as when retries pile up copies), the verdict is
  unfinished, not holds. When the paths that matter are simply longer than the depth (a push
  through five services and back), raise `--depth`, or `check: { depth }` in
  feynman.config.ts for every run, until the verdict is ✓ or ✗.
- **Stuck.** A world where nothing can happen (no message or timer pending, no action
  possible, no fair guard true; an exhausted `atMost` or budget does not count) is reported
  as stuck: a deadlock, or a wait nothing will end. A system that
  is meant to finish says where with `finalState: { description, when: (w) => … }` in `defineSpec`;
  stopping there is fine. Say what finished means (`w.quiet && no call is waiting`): a final
  state of `w.quiet` alone calls every deadlock finished, including a caller waiting forever.
- **Order.** Any message may overtake any other, as on separate connections. Messages on one
  WebSocket or stream cannot; if a counterexample depends on such an overtaking, say so in
  the report rather than "fixing" the system.
- **`when` guards** gate actions (offered only while true) and internal transitions (which
  then run whenever true, without a timer).

## Bringing an older spec up to date

Specs written before the presentation vocabulary existed still run; they just look and
read worse. To update one:

1. Run `feynman check` first and keep its result, so you can tell later whether you
   changed behaviour.
2. Re-read the modelling rules above against the spec: actors that are really one
   process, steps that hide several stages (check prints "stands for N pieces of
   code"), generic names, ids where people use labels.
3. Add, for every actor: `display.icon`, `status`, `mood`, and `owner` where something
   belongs to someone. Add `rows` on the service the others talk to, `links` for
   connections that come and go (with `row` when they meet a row), `say` on the steps
   that matter, and `description` on zones.
4. Mark heartbeats, lease renewals and polling `routine: true`, or remove them if their
   expiry never changes what happens.
5. Declare `display.tokens` and `accepts` for every hand-off a person makes, such as a code
   shown on one device and typed on another.
6. Add `place` only where the computed map misreads: a gate on the edge of a region
   (`edge`), zones in the wrong order (`column`), or a busy zone (`arrange`).
7. Group what a newcomer would see as one thing (`defineGroup`): the service whose
   parts are separate actors, and each machine that runs two of them. Add `display.names`
   for people and `expires` on tokens that expire, and list the groups in `defineSpec`'s
   `groups`.
8. If a hand-off or a result is still hard to see (a terminal, a Settings pane), add a
   playground file.
9. If it uses `--faults`, `--repeats`, `durable`, `s.drop` or `s.restart`, it predates
   0.15, where faults became steps the spec declares (RFD0012). Declare a budget and the
   faults the system has: `lose(M, { spend: faults })` in the receiver for each message the
   network may lose, `crash({ keeps: [...durable], spend: faults })` in each actor that may
   restart, and `with: [atMost(2)]` on each action. `s.drop(x, M)` becomes
   `s.step(x, "mLost")` and `s.restart(x)` becomes `s.step(x, "crash")`. A step on
   `failed(Call)` stays; a lost reply that fails its call says so with `fails`.
10. Turn every safeguard switched by hand into a rule: a `const SOME_RULE = true` flipped to
   see a property break, a `buggy`/`fixed` branch, or a copy of the spec without a guard.
   `defineRule`, `rule.on` where it applies, `needs: [rule]` on what it protects.
11. If it is written `defineSpec(name, { messages }, (spec) => { … })`, it predates 0.14,
    where a spec became its parts. Move each part to the top level of the file:
    - each `message<P>({ name, … })` becomes `defineMessage("Id", schema, { name, … })`,
      with the payload's type as a schema (`{ text: String }`), and `call<P>` becomes
      `defineCall`;
    - `spec.defineX({ … })` becomes `defineX(…)`; rules, properties and scenarios take
      their name or id first: `defineRule("cap", { description })`,
      `defineProperty("oneHolder", { … })`, `defineScenario("A payment", { … })`, and
      `spec.defineInput` becomes `input`;
    - a transition keyed `[Charge]` becomes a named step with `on: Charge`, and one keyed
      `[spec.failed(Charge)]` a step with `on: failed(Charge)`;
    - a timer's or guard's `run(state, ctx)` becomes `run(state, _, ctx)`;
    - scenarios and `e.sent`/`e.replied` name messages by value: `s.deliver(bank, Charge)`,
      not `"Charge"`; `e.is(Actor, "step")` names a step by its new name;
    - `defineFinalState` moves into `defineSpec({ finalState })`, and
      `return { …actors }` with `spec.handles` becomes exported actors.

    Then `export default defineSpec({ name, actors, groups, properties, scenarios })`.
12. If it calls `s.wait`, passes `s.settle` a duration, or reads `ctx.now`, it predates
    time being the order of events. Each deadline becomes a timer
    that may fire at any point, and each wait in a scenario an `s.fire(instance, "timer")`.
13. Run `feynman check` again: the same properties must hold, with the same
    counterexamples, unless you fixed a modelling mistake. Say which.

## Commands

```
feynman list                   the specs found
feynman run [spec] [--scenario NAME | --all] [--without RULE]
feynman check [spec] [--depth 14] [--set faults=1] [--instances Actor=N] [--max-states N] [--time-limit S]
              [--memory-limit GB] [--walks 2000] [--walk-depth 120] [--no-symmetry] [--symmetry-checks 2000]
              [--only P,Q] [--without RULE,RULE] [--no-rules] [--brief | --json | --as-scenario]
feynman lock                   record source hashes in feynman.lock
feynman diff [spec] [--base main]
feynman dev [--port 4321] [--base REF]
feynman build [--out .feynman/index.html | DIR/] [--base REF]   minified self-contained HTML + .gz/.br variants
feynman open
```

`check` explores in two ways. A breadth-first search tries every order of events up to
`--depth` and finds the shortest counterexample. Random runs (`--walks N`, up to
`--walk-depth` steps, a quarter of the time) go far deeper and find bugs the search cannot
reach. Their counterexamples are shrunk but may not be the shortest, and they prove nothing.
The search runs on one thread, on worlds as integers (RFD0008).
Read the verdicts as:

- `✓` holds in every state within the bounds;
- `~` held in the states explored, but the search stopped early: not a proof;
- `?` never tested: no explored world got to where it applies (add a scenario that does);
- `✗` broken, by the search, a random run, or a scenario; in yellow with "known bug" when
  the property is marked `known`, which does not fail the check.

Each counterexample says how many faults it needs: the fewest with which the property
breaks within the bounds, and the length of a shorter path that needs more, if there is one.

Read check's output with its own flags, not with grep:

- `feynman run <spec>` with several scenarios prints one line each (✓, or ✗ and why);
  `--scenario NAME` prints one trace, `--all` every one.
- `--brief`: one line per property, and for each counterexample its length and faults.
  Start here when several specs or properties fail.
- `--only P`: check and show only property P, with its counterexample.
- `--json`: everything, structured: verdicts, counterexamples with their events, scenario
  failures, sources. For scripts, and for reading many results at once.
- `--only P --as-scenario`: P's counterexample as `defineScenario` code that replays
  it step by step. Paste it into the spec to keep the bug as a flow, and use it as the
  outline of a regression test in the system's own test suite.

When `check` stops at a limit (states, time, or memory), it says so, and how far it got:
a safety property "held on every path of up to N events". It also says what the states
differ in most ("Session.outcomes (1,359 values)"). A field with many values (a log, a
counter, ids, a list that only grows) is usually the cause: bound it, or keep only what the
properties read. Without one, it is the orders of what is in flight: smaller `atMost` limits,
fewer instances, or a smaller budget (`--set faults=0`). Do not just raise `--max-states`: a state space that is too big usually
means the spec models too much.

A `feynman.config.ts` at the repository root can name spec globs and checker defaults:

```ts
import { defineConfig } from "@leostera/feynman/config";
export default defineConfig({ specs: ["docs/specs/*.ts"], check: { depth: 12, instances: { Mac: 2 } } });
```

## What to report back

When you finish, report:

- the spec's path, and the playground file's if you wrote one;
- what it covers and what it leaves out;
- the scenarios;
- the check result: which properties hold, within which bounds, and every counterexample,
  each classified as a spec mistake (fixed), intended behaviour (invariant rewritten), or a
  system finding (with the trace, the faults it needs, and any production evidence);
- any sources you could not pin down.
