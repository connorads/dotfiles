---
name: feynman
description: Write and check Feynman specs, which are small executable models of how part of a system behaves (actors, messages, timers, invariants, scenarios) tied to the code by sources. The feynman CLI derives a playground, flows, model checking and diffs from them. Use to explain how a feature works, to review how a change affects behaviour, or to design a feature before or while building it.
---

# Feynman specs

A spec is a TypeScript file that models one behaviour of a system as a deterministic,
discrete-event program. You write the spec. The `feynman` CLI derives everything else
from it:

- a playground to try it in;
- the flows of every scenario;
- a bounded model checker for its invariants;
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
  show them as one Mac with `spec.defineGroup` (below).
- **Use the system's own words** for actors, messages, steps, statuses, files and tables:
  `READY`, `analysis.json`, "Pending folder". Don't invent generic roles such as
  "processor", "pipeline" or "store" unless the code uses them. Keep names short; put the
  tool list ("yt-dlp / Instaloader") in `description` or `look.status`, not the name.
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
   - explores every interleaving within bounds, then checks the invariants and that every
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
   no faults" means it happens in normal operation, without a lost message or a restart).
   One fault on a rare path is a different finding from a plain delete-then-create. When
   you can reach production evidence (logs, error tracking, metrics), look for whether it
   happens, and say what you found; keep only findings with evidence or a severe outcome.
   A finding that stays until it is fixed gets `known: "why, or the issue"` on its
   property: check still reports it, but no longer fails on it.
5. Run `feynman run <behaviour>` to read the traces of the scenarios as text.
6. Once the spec is right, run `feynman lock`. It records the code each source stands
   for, so later checks flag sources whose code changed.
7. Optionally, run `feynman dev` (or `build`/`open`) to open the explorer. Use
   `--base main` to compare with a branch.

**Do not commit unless asked.**

## The DSL

```ts
import { defineSpec, message } from "@leostera/feynman";

export default defineSpec(
  "Remote access",
  {
    description: "How a Mac gets linked to an account with a one-time pairing code.",
    // Every message, declared first. Payload types are what the checker and editor see.
    messages: {
      NewCode: message<{ account: string }>({ name: "new pairing code", over: "https" }),
      Code: message<{ code: string }>({ name: "pairing code", over: "https", tone: "reply" }),
      Redeem: message<{ code: string; host: string }>({ name: "redeem", over: "https" }),
      Redeemed: message<{ account: string }>({ name: "redeemed", tone: "reply" }),
      Refused: message<{ status: 404 }>({ name: "refused", tone: "refused" }),
    },
  },
  (spec) => {
    const { NewCode, Code, Redeem, Redeemed, Refused } = spec.messages;

    const devices = spec.defineZone({ name: "People's devices", description: "signed in with Access" });
    const cloud = spec.defineZone({ name: "Cloudflare" });

    // A number the code names. Specs have no clock: this documents the system, it does not run.
    spec.defineLimit({
      name: "Pairing code lifetime",
      value: 10,
      unit: "minutes",
      sources: ["packages/api/src/pairing.ts#CODE_TTL"],
    });

    const Relay = spec.defineActor({
      name: "Relay",
      description: "The Worker that issues and redeems pairing codes.",
      zone: cloud,
      singleton: true, // exactly one, present from the start
      initialState: () => ({ codes: {} as Record<string, { account: string; used: boolean }> }),
      durable: ["codes"], // survives a restart (it lives in a database)
      // How it is drawn in the playground: an icon, a status, and its state as rows.
      look: {
        icon: "cloud",
        status: (s) => `${Object.values(s.codes).filter((c) => !c.used).length} code(s) waiting`,
        // `owner` names the person a row belongs to, so the account box wears their colour.
        rows: (s) => Object.values(s.codes).map((c) => ({ group: `${c.account}'s account`, owner: c.account.replace(/^acct-/, ""), label: "pairing code", detail: c.used ? "used" : "unused", mood: c.used ? "off" : "info" })),
      },
      transitions: {
        // Keyed by message: runs when the message is delivered.
        [NewCode]: {
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
        [Redeem]: {
          description: "Checks the code and, if valid, links the Mac.",
          sources: ["packages/api/src/routes/pairing.ts#redeemPairing", "packages/api/src/pairing.ts:31-58"],
          sends: [Redeemed, Refused],
          run(state, msg, ctx) {
            const entry = state.codes[ctx.hash(msg.code)];
            if (!entry || entry.used) return ctx.reply(Refused, { status: 404 }, "Unknown or used.");
            entry.used = true;
            ctx.reply(Redeemed, { account: entry.account });
          },
        },
      },
    });

    const Person = spec.defineActor({
      name: "Person",
      zone: devices,
      initialState: (ctx) => ({ account: `acct-${ctx.label}`, codes: [] as string[] }),
      look: {
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
          label: "Pair a Mac",
          description: "Asks the relay for a code to type on a Mac.",
          sources: ["apps/web/src/pair.tsx#createCode"],
          sends: [NewCode],
          run: (state, _inputs, ctx) => ctx.send(ctx.the(Relay), NewCode, { account: state.account }),
        },
      },
      transitions: {
        [Code]: { description: "Shows the code.", sources: ["apps/web/src/pair.tsx#showCode"], run: (s, msg) => void s.codes.push(msg.code) },
      },
    });

    const Mac = spec.defineActor({
      name: "Mac",
      zone: devices,
      initialState: () => ({ account: null as string | null, pending: null as string | null }),
      look: {
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
          label: "Paste a pairing code",
          description: "Links this Mac to the account that issued the code.",
          // Inputs have a type; examples are what the playground offers and the checker tries.
          // Examples are what the playground offers and the checker tries: a list, or a function of the world.
          // Give such functions a return type when they name another actor (see "Types" below).
          inputs: { code: spec.defineInput(String, { examples: (w): string[] => [...w.all(Person).flatMap((p) => p.state.codes), "never-issued"], accepts: "pairing code" }) },
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
        [Redeemed]: {
          description: "The Mac is linked.",
          sources: ["crates/axod/src/pairing.rs#finish"],
          run(state, msg, ctx) {
            state.account = msg.account;
            state.pending = null;
            ctx.cancel("redeemTimeout");
          },
        },
        [Refused]: { description: "Stays unlinked.", sources: ["crates/axod/src/pairing.rs#refused"], run: (s, _m, ctx) => ((s.pending = null), ctx.cancel("redeemTimeout")) },
        // Keyed by a label: an internal transition, run as a timer (ctx.start) or whenever `when` holds.
        redeemTimeout: {
          description: "No answer in time; gives up.",
          after: "5 seconds", // when the code fires it, for readers; it may fire at any moment
          sources: ["crates/axod/src/pairing.rs#timeout"],
          run: (s) => void (s.pending = null),
        },
      },
    });

    spec.defineInvariants({
      // always: holds in every state.
      codesAreHashed: { description: "The relay stores only hashes of codes.", always: (w) => Object.keys(w.the(Relay).state.codes).every((k) => k.startsWith("hash:")) },
      // eventually: once `after` holds, the system left alone gets there.
      pendingResolves: { description: "A Mac waiting for an answer gets one.", eventually: (w) => w.all(Mac).every((m) => m.state.pending === null) },
      // never: no trace has this shape.
      redeemedOnce: { description: "A code is never redeemed twice.", never: (t) => t.count((e) => e.replied(Redeemed)) > t.count((e) => e.is(Person, "pair")) },
      // known: a bug found and not fixed yet. Check reports it without failing, and fails once it holds.
      // codesExpire: { description: "…", always: (w) => …, known: "RELAY-12: expiry is not enforced yet" },
    });

    // Scenarios: the flows a reader should see, scripted. Each becomes a flow and a playground start.
    spec.defineScenario({
      name: "Link a Mac",
      description: "The happy path: a person pairs, the Mac redeems the code.",
      run(s) {
        const alice = s.spawn(Person, "Alice");
        const studio = s.spawn(Mac, "Studio");
        s.act(alice, "pair");
        s.settle(); // left alone: messages in send order, then, when none is in flight, timers
        s.act(studio, "link", { code: alice.state.codes[0] });
        s.settle();
        // s.the(Actor) reaches singletons; s.world reads the whole world.
        if (!s.the(Relay).state.codes) throw new Error("unreachable");
        // One step at a time, in any order: s.deliver(relay, "Redeem") delivers a message in
        // flight now, s.drop(relay, "Redeem") loses it, s.fire(studio, "retry") fires a timer,
        // s.step(who, "transition") runs a guarded transition, s.restart(who) restarts.
      },
    });

    // Every actor, so a playground file can name them: spec.handles.Person.
    return { Relay, Person, Mac };
  },
);
```

### Rules the engine enforces

- **Determinism.** Handlers see the world only through `ctx`:
  - `id`, `label`;
  - `fresh(prefix)` for ids, `hash(value)` and `random()`;
  - `send`, `reply`, `start(label)` and `cancel(label)`;
  - `the(Actor)`/`all(Actor)` to find instances, and `note(text)`.

  Don't use `Date`, `Math.random`, `async`, I/O or module-level mutable state.
- **Mutate `state` in place.** The engine records each change as `path: before → after`.
- **Declare effects.** Every message a step sends must be listed in its `sends`, and every
  timer it starts in its `starts`. The types check most of this. An undeclared send at
  runtime is a spec error, and the step's effects are discarded.
- **Every message needs a handler.** A delivered message with no transition on the
  receiver is a spec error.
- **Write descriptions in everyday words**, one sentence, about what happens and not how
  the code does it. Use `ctx.note(text)` or the `text` argument of `send`/`reply` for what
  is specific to one event.

### Make the playground worth looking at

The playground is drawn from the spec, so the spec decides how good it looks. For every
actor, add:

- **`look.icon`.** One of `person`, `people`, `phone`, `laptop`, `desktop`, `browser`,
  `server`, `cloud`, `database`, `shield`, `key`, `lock`, `terminal`, `robot`, `queue`,
  `folder`, `file`, `sheet`, `globe`, `gear`, `camera`, `video`, `mail`, `bell`, `clock`,
  `cpu`, `box`, `plug`, `wifi`, `chat`, `router`, `storage`, `code`, `pipeline`, `eye` or
  `card`.
- **`look.status`:** a few words under the name, such as "connected", "not linked" or
  "3 jobs queued".
- **`look.mood`:** `ok`, `warn`, `bad`, `busy`, `off` or `info`, which colours the node.
- **`look.rows`** for state worth seeing as structure, such as a service's accounts and
  hosts, or a queue's jobs. Give each row a `label`, an optional `detail` and `mood`, and
  a `group` to box rows together. Use it on hubs (singletons); on other actors, keep it to
  one to three rows.
- **`links`** for connections that come and go: sockets, sessions, subscriptions. Only
  live links are drawn prominently.
- **`look.owner`:** whose this is, as an instance label or id: a Mac belongs to the person
  whose account it is linked to. It then wears that person's colour, so readers can
  follow Alice through the system.
- **`routine: true`** on housekeeping steps a reader need not watch, such as heartbeats,
  lease renewals or polling. The playground folds runs of them into one timeline line
  and does not stop for them; the checker explores them like any other step. Better
  still, leave out a heartbeat unless its expiry changes what happens.
- **`look.tokens`** for things a person would carry from one node to another: a pairing
  code shown on a phone, a link to share, a file to upload. Each is `{ kind, value, label? }`,
  and it floats beside the node. Give the receiving action's input `accepts: kind`, as in
  `spec.defineInput(String, { examples, accepts: "pairing code" })`. Dragging the token onto
  that node then runs the action with it. This is the most memorable way to show a
  hand-off between actors. Without any declared tokens, the playground infers them: a
  value an action's input examples read from another instance's state can be dragged
  from that instance. Declare tokens when you want control over what shows.
- **`row`** on a link: the label of the target's row it ends at. With it, a Mac's socket
  meets that Mac's line in the relay rather than the relay's icon.
- **`owner`** on a row: the instance it belongs to, by id or label. The row's group, and
  the row itself if it has no mood, take that instance's colour; links take their
  source's. Readers can then follow Alice through the system.
- **Zone `description`**: a few words beside its name, such as "sign in with Access".
- **Placement hints**, when the computed map does not tell the story; there are no
  coordinates.
  - On a zone, `place: { column, region, align, arrange }`:
    - `column` orders zones left to right, from 0;
    - `region: true` draws the zone as the tinted area everything hangs off (a zone holding
      a singleton is one by default);
    - `align` is `"start"`, `"center"` or `"end"`;
    - `arrange` is `"stack"`, `"row"`, `"grid"` (shards) or `"ring"` (peers in a cluster).
  - On an actor, `place: { order, edge }`:
    - `order` sorts its instances within the zone;
    - `edge: "left" | "right"` sets it on the zone's border, like a gate everything passes
      through.
- **Groups**, for the level of abstraction a newcomer needs. Model each process as its
  own actor, as the checker needs, then say which read as one thing:
  ```ts
  // One relay for people, as the product presents it.
  spec.defineGroup({ name: "Axo relay", actors: [Worker, Manager, Index], icon: "cloud" });
  // One Mac: "Studio app" and "Studio daemon" are one "Studio"; + adds both.
  spec.defineGroup({ name: "Mac", actors: { app: App, daemon: Axod }, icon: "laptop", names: ["Studio", "iMac"] });
  ```
  A list of singletons is one node. A record groups other actors' instances by label
  suffix. A closed group is one node: messages between its members don't fly across the
  map, and they fold in the timeline as "inside Axo relay". Readers open it with "Look
  inside". Groups start closed; pass `collapsed: false` to start open.
- **`look.names`**: labels for instances added in the playground, such as
  `["Alice", "Bob"]`, rather than "Person 2".
- **`look.shape`** only to override the default: services (cloud, server, database…) are
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

Make the body of `defineSpec` end with `return { Person, Relay, … }`, every actor. Other
files (a playground file, a helper) then reach them, typed, as `spec.handles.Person`.

### Playground files

Write `specs/<behaviour>.play.tsx` only when the defaults cannot show something the
reader must see to understand the domain. Examples: a terminal on the phone that has a Mac
open, with commands to click and their output; the status a group shows while closed
("1 code waiting"); a custom drawing for one node. The spec stays the model: the checker,
flows and diffs never load this file, and removing it leaves a working playground.

```tsx
import { definePlayground, Terminal } from "@leostera/feynman/play";
import spec from "./remote-access.ts";

const { Person, Manager, Axod } = spec.handles;

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
- **Render functions only draw and act.** They receive typed `state`, `look` (the
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

- `import { defineSpec, message } from "@leostera/feynman"` is all a spec needs.
  For helpers, the types are `Actor`, `Instance`, `World`, `Ctx`, `Script`, `Look`,
  `Link`, `Row`, `Token`, `Icon`, `Mood`, `ZonePlace` and `ActorPlace`.
- **Let inference work; don't annotate actors.** If tsc says an actor "implicitly has type
  'any' because it … is referenced directly or indirectly in its own initializer", two
  actors refer to each other inside a function whose return type TypeScript has to infer.
  This is usually input `examples`. Give that function a return type:
  `examples: (w): string[] => …`.
- To send to yourself, use `ctx.send(ctx.self, …)`. Avoid `ctx.the(ThisActor)`.
- **Actions without inputs** leave out `inputs`. Scenarios call them as `s.act(x, "pair")`.
- **Use one message per meaning.** If a refusal means different things in different
  places, declare different messages. Don't add a field to tell them apart.
- Write `durable` as a list of state fields, like `durable: ["codes"]`.

### Sources

`sources` is an ordered trail from the entry point inwards. Each entry is either:

- `path#symbol`, with `Outer.method` or `Outer::method` for methods, found by definition in
  TypeScript, JavaScript, Rust, Swift, Go, Python and more;
- `path:start-end`, when there is no symbol.

Paths are relative to the repository root. The first `path#symbol` of a step is the root
of its call tree in the explorer.

**Point at real code; never invent paths.** `feynman check` fails on sources that don't
resolve. When the code does not exist yet, leave `sources` out of that step instead.

### Modelling choices

- **Instances.** Use `singleton: true` for things there is one of (a service, a database).
  For the rest, scenarios `spawn`, and the checker uses one of each, or more with
  `--instances Mac=2`. Two of an actor are cheap when you declare `symmetric: true` on it:
  the checker then treats "Alice, then Bob" and "Bob, then Alice" as one state. Declare it
  only when the spec compares the actor's ids and labels for equality and never orders or
  computes with them (electing the highest id, hashing an id). The checker tests the claim
  and says when it is false.
- **State.** Keep only what decides behaviour. Use hashes, not secrets (`ctx.hash`).
- **Repeats.** The checker lets each instance take the same action at most `--repeats N`
  times on one path (2 by default). Raise it when a bug needs more.
- **Faults.** The checker loses messages and restarts instances within `--faults N` (1 by
  default). State listed in `durable` survives a restart.
- **Time.** Specs have no clock: a run is an order of events, and anything pending may go
  next. A timer (`ctx.start(name)`) may fire at any moment until it fires or is cancelled,
  so "the retry fires before the reply arrives" is always possible, as it is in production.
  Say how long the code waits with `after: "5 seconds"` on the timer's transition and
  `defineLimit` for named values; they are for readers. An expiry is a timer that flips state
  (`expired = true`), never a stored time. When an ordering really depends on durations (a
  heartbeat always beats an expiry, on one machine), model it with state and say so; usually
  the counterexample is a real risk.
- **Left alone.** `s.settle()`, `eventually` and the playground's Play all run the system
  left alone: messages in the order they were sent, and when none is in flight, the timers
  that are set, oldest first, up to 200 events. So a scenario's `settle()` also fires
  timeouts and expiries once the network is quiet: act before settling if something must
  happen before a timer. `s.fire(who, "retry")` fires a timer early, ahead of what is in
  flight.
- **In the end.** `w.quiet` is true when nothing is in flight. "Once quiet, the nodes agree"
  is a safety property (`always: (w) => !w.quiet || …`), cheaper and sharper than an
  `eventually` when what you mean is "after everything has arrived".
- **Never.** A `never` property sees the path through `trace.count` and `trace.some`; prefer
  those to reading `trace.events`, which makes every path its own state.
- **Eventually.** An `eventually` property is judged on the system left alone from each
  explored world: no actions, no faults, messages before timers. The search itself tries the
  other orders.
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
3. Add, for every actor: `look.icon`, `status`, `mood`, and `owner` where something
   belongs to someone. Add `rows` on the service the others talk to, `links` for
   connections that come and go (with `row` when they meet a row), `say` on the steps
   that matter, and `description` on zones.
4. Mark heartbeats, lease renewals and polling `routine: true`, or remove them if their
   expiry never changes what happens.
5. Declare `look.tokens` and `accepts` for every hand-off a person makes, such as a code
   shown on one device and typed on another.
6. Add `place` only where the computed map misreads: a gate on the edge of a region
   (`edge`), zones in the wrong order (`column`), or a busy zone (`arrange`).
7. Group what a newcomer would see as one thing (`spec.defineGroup`): the service whose
   parts are separate actors, and each machine that runs two of them. Add `look.names`
   for people and `expires` on tokens that expire. End the body with
   `return { …every actor }`.
8. If a hand-off or a result is still hard to see (a terminal, a Settings pane), add a
   playground file.
9. Run `feynman check` again: the same invariants must hold, with the same
   counterexamples, unless you fixed a modelling mistake. Say which.

## Commands

```
feynman list                   the specs found
feynman run [spec] [--scenario NAME]
feynman check [spec] [--depth 14] [--faults 1] [--repeats 2] [--instances Actor=N] [--max-states N] [--time-limit S]
              [--walks 2000] [--walk-depth 120] [--no-symmetry]
              [--only P,Q] [--brief | --json | --as-scenario]
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
Read the verdicts as:

- `✓` holds in every state within the bounds;
- `~` held in the states explored, but the search stopped early: not a proof;
- `?` never tested: no explored world got to where it applies (add a scenario that does);
- `✗` broken, by the search, a random run, or a scenario; in yellow with "known bug" when
  the property is marked `known`, which does not fail the check.

Each counterexample says how many faults it needs: the fewest with which the property
breaks within the bounds, and the length of a shorter path that needs more, if there is one.

Read check's output with its own flags, not with grep:

- `--brief`: one line per property, and for each counterexample its length and faults.
  Start here when several specs or properties fail.
- `--only P`: check and show only property P, with its counterexample.
- `--json`: everything, structured: verdicts, counterexamples with their events, scenario
  failures, sources. For scripts, and for reading many results at once.
- `--only P --as-scenario`: P's counterexample as `spec.defineScenario` code that replays
  it step by step. Paste it into the spec to keep the bug as a flow, and use it as the
  outline of a regression test in the system's own test suite.

When `check` stops at its limits, it says so. If that happens, lower `--depth`, use
fewer instances, or narrow the examples of inputs. An explored state space that is too
big usually means the spec models too much.

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
