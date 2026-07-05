# Notation contract, anti-patterns, and quality checklist

C4 is notation-independent, but every diagram must be **self-explanatory**. These
are the rules from [c4model.com/diagrams/notation](https://c4model.com/diagrams/notation),
plus the failure modes agents hit and a final checklist.

## The metadata contract

Treat these as required fields, not suggestions. A renderer won't enforce them -
you must.

### Every element

- **Name** - clear, specific.
- **Type** - stated explicitly: `[Person]`, `[Software System]`, `[Container]`,
  `[Component]`. In Mermaid/DSL the macro encodes this; in boxes-and-lines write
  it or show it via the legend.
- **Technology** - **mandatory on Containers and Components** (e.g.
  `[Container: Node.js + Express]`, `[Component: Spring MVC Controller]`).
  Omitting tech makes a diagram look like ivory-tower fluff.
- **Description** - a short responsibility line ("Handles auth and session
  issuing"), so the diagram reads at a glance.

### Every relationship (line)

- **Unidirectional** - one arrow, one direction (dependency or data flow). Use
  two lines if genuinely bidirectional.
- **Specifically labelled** - a verb phrase describing intent. **Never** a bare
  "Uses", "Calls", "DB", "Backend". Prefer "Reads user profiles from",
  "Publishes job messages to".
- **Protocol/technology on inter-container lines** - the interprocess hop must
  say how: `[JSON/HTTPS]`, `[gRPC]`, `[AMQP]`, `[JDBC]`.

### Every diagram

- **Title** - type + scope, e.g. `System Context diagram for Internet Banking
  System`.
- **Legend / key** - explains every shape, colour, border, line, and arrowhead
  used. Applies even to UML/ArchiMate. Any acronym must be in the key or
  understood by all audiences.

### Colours

- The blue/grey C4 example palette is **not** dictated - use any colours.
- Keep colour-coding **consistent** within and across diagrams.
- Account for **black-and-white printing and colour blindness** (don't rely on
  colour alone; use labels/shapes/borders too).

## Evidence discipline (when deriving from code)

- Every element and relationship must trace to **something you actually read**
  (a manifest, a route, a client call, a config).
- Mark each fact **Observed** (found in the code/config) or **Inferred** (a
  reasonable guess). Never let a guess masquerade as fact.
- **"Misleading documentation is worse than no documentation."** If unsure
  whether a managed service sits inside the system boundary, whether an actor
  exists, or how prod is deployed - **ask**, don't invent.

## Anti-patterns (hard NOs)

| Anti-pattern | Why it's wrong | Do instead |
|---|---|---|
| **Container = Docker container** | Container is a runtime app/data store; Docker is deployment | Model apps/data stores; put Docker in a Deployment diagram node |
| **Container = JAR/module/package/folder** | Those organise code, not runtime | A container must be a running app or a data store |
| **Mixing abstraction levels** | Components next to external systems, classes on a container diagram - unreadable | One level per diagram; state the level in the title |
| **Inventing elements** | Fabricated actors/systems/components mislead | Evidence-first; label Observed vs Inferred; ask |
| **Folder dump** | One component box per source folder, described file-by-file | Components describe *responsibilities*; group by behaviour, cap the count |
| **Weak arrows** | "Uses" / "DB" / "Backend" say nothing | Verb phrase + protocol + direction |
| **No title/scope/legend** | Diagram can't stand alone | Add all three |
| **Kitchen-sink diagram** | Tries to show everything, high cognitive load | Split into focused diagrams at the same level |
| **Over-documenting** | Component/Code diagrams for trivial services | Context + Container is usually enough |
| **Infra soup** | Subnets, IAM roles, security groups, log groups on a C4 diagram | Exclude unless architecturally central; that's deployment detail |
| **Drift** | AI-accelerated code outruns hand-drawn diagrams | Prefer a single-source model (DSL) or generate; keep to code |

## Quality checklist

Run before presenting. Fix anything that fails.

### Model correctness

- [ ] Every container is a runnable app or a data store (no Docker/JAR/module).
- [ ] Every component runs in its container's process (not independently deployed).
- [ ] Owned cloud data services modelled as containers, not external systems.
- [ ] External systems and actors are all backed by evidence (or asked about).
- [ ] Each element labelled Observed or Inferred (derive-from-code mode).

### Diagram hygiene

- [ ] Exactly one abstraction level per diagram.
- [ ] Every diagram has a title stating type + scope.
- [ ] Every diagram has a legend/key.
- [ ] Every element has type + description; containers/components have technology.
- [ ] Every relationship is one-directional and specifically labelled.
- [ ] Inter-container relationships name a protocol/technology.
- [ ] No diagram is overcrowded; crowded ones were split, not shrunk.
- [ ] Colour-coding consistent and not the sole carrier of meaning.

### Deliverable

- [ ] The diagram was actually **rendered** (`scripts/render.sh`) with no errors.
- [ ] Open questions / assumptions listed alongside the diagrams.
- [ ] Rationale/decisions handed to ADRs, not stuffed into the diagram.
