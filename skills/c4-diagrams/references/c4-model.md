# The C4 model

Canonical source: [c4model.com](https://c4model.com) (Simon Brown, maintained).
Book: *Software Architecture for Developers* / *The C4 model* (O'Reilly). C4 is
**abstraction-first, notation-independent, tooling-independent**. Named after its
four core diagrams: **C**ontext, **C**ontainers, **C**omponents, **C**ode.

## The abstraction hierarchy

> A software system is made up of one or more containers (applications and data
> stores), each of which contains one or more components, which in turn are
> implemented by one or more code elements. And people use the software systems
> that we build.

```text
Person  ──uses──▶  Software System
                    └─ Container (an app or a data store)
                        └─ Component (grouping of code behind an interface)
                            └─ Code (class / function / interface)
```

### Person

A human user: actor, role, persona, or named individual.

### Software System

The **highest** abstraction; something that delivers value. A context/container
diagram includes both **the system in scope** and the **external systems** it
depends on or that depend on it.

Rule of thumb: a software system is something **one dev team owns, is
responsible for, and can see inside** - often one repo, often one deployable
unit, often one team boundary. *Not* usually a software system: a product
domain, a bounded context, a business capability, a squad/tribe.

### Container - the most misunderstood term

A container is **an application or a data store** - something that **must be
running** for the system to work. It is a *runtime* boundary around executing
code or stored data.

**Is a container:** server-side web app · client-side SPA (browser JS app) ·
desktop app · mobile app · server-side console/batch app · a single serverless
function (Lambda/Azure Function) · a database schema · a blob/content store (S3,
CloudFront) · a file system · a shell script.

**Is NOT a container:** a Docker container · a JAR / .NET assembly / DLL · a
module / package / namespace / library. Those organise code *within* an
application; a container is a runtime construct.

Landmines:

- **Container ≠ Docker container.** The name predates and clashes with Docker;
  keep them separate. (You *may* rename the term for your team if it confuses.)
- **Deployment is a separate concern.** The same web app is one container whether
  three copies run on one server in dev or each on its own box in prod. Runtime
  topology goes in a **Deployment** diagram, not the container diagram.
- **SPA = its own container.** A server app that also ships a significant
  browser SPA (React/Angular/Vue) is **two containers** (server + client) - they
  are separate process spaces talking over JSON/HTTPS, and each can be zoomed
  into separately.
- **Owned cloud data services are containers, not external systems.** Your S3
  buckets, RDS/Azure SQL schemas are part of *your* architecture - model them as
  containers even though the provider hosts them.

### Component

A **grouping of related functionality behind a well-defined interface**, running
**in the same process** as its container. Simplest mental model (OO): a set of
implementation classes behind an interface. Per language: OO = classes +
interfaces; C = source files in a directory; JS = a module of functions/objects;
functional = a module grouping related functions/types.

Critical constraints:

- **Components are not separately deployable.** The **container** is the
  deployable unit; all its components share one process space.
- How components map to JARs/DLLs/packages/folders is **orthogonal** - a
  component may span several, or map 1:1 (hexagonal). A JAR/package/folder is
  **not itself** a component.

### Code

Classes, interfaces, enums, functions - the language's basic building blocks.
Almost never worth drawing by hand.

## The diagrams (levels of zoom)

The four core diagrams map **1:1** to the abstractions. **You do not need all
four** - use only what adds value. **System Context + Container are enough for
most teams.**

### 1. System Context (recommended for all teams)

- **Scope:** a single software system (one box in the centre).
- **Shows:** that system + the people who use it + the external systems it
  interacts with. Focus on people and systems, **not** technologies/protocols.
- **Audience:** everyone, technical and non-technical.

### 2. Container (recommended for all teams)

- **Scope:** a single software system.
- **Shows:** the containers inside it, the responsibilities spread across them,
  **major technology choices**, and how containers communicate (with protocol).
  Plus the people and external systems directly connected.
- **Audience:** technical - architects, developers, ops/support.
- Deliberately says little about clustering/load-balancing/deployment - that's
  the deployment diagram's job.

### 3. Component (only when it adds value)

- **Scope:** a single container.
- **Shows:** the components inside it (with responsibilities + technology), plus
  directly connected containers/people/systems.
- **Audience:** architects and developers.
- Not broadly recommended. For long-lived docs, prefer **automating** it
  (reverse-engineering from code) over hand-drawing, because it drifts fastest.

### 4. Code (rarely)

- **Scope:** a single component. UML class / ER diagrams.
- Usually generated on demand by an IDE. Only for the most important/complex
  components; not for long-lived docs.

## Supplementary diagrams

### System Landscape (recommended, esp. larger orgs)

A map of **all** systems and people within an enterprise/department - a System
Context diagram *without* focus on one particular system. A bridge toward
enterprise architecture.

### Deployment (recommended)

How **instances** of systems/containers map onto infrastructure in **one**
environment - **one diagram per environment** (production, staging, dev).

- **Deployment node** = where an instance runs: physical / virtualised (IaaS,
  VM) / **containerised (a Docker container lives *here*)** / an execution
  environment (DB server, app server). Nodes can be **nested**.
- **Infrastructure node** = DNS, load balancer, firewall, etc.
- Cloud provider icons (AWS/Azure) are fine **if** they're in the key.

### Dynamic (use sparingly)

How elements collaborate at **runtime** to implement one story/use case, with
**numbered** interactions to show order (UML communication or sequence style -
either is fine). Scope = one feature. May show systems, containers, *or*
components interacting. Only for interesting/complex/recurring flows.

## Notation, scope limits, companions

- **Notation independence.** C4 prescribes no notation. Boxes-and-lines,
  Mermaid C4, Structurizr, C4-PlantUML, UML, ArchiMate, even D3/Ilograph are all
  valid. Test: does each diagram stand alone without a narrative?
- **Scope limit.** C4 is **static structure only** - not business process,
  workflow, state, or data models. Supplement with BPMN / UML / ER.
- **Best fit:** custom-built systems (monolith or distributed, any language,
  on-prem or cloud). Weaker fit: embedded/firmware, heavy-customisation
  platforms (SAP, Salesforce) - though Context + Container may still help.
- **arc42 mapping:** Context & Scope -> System Context; Building Block View L1 ->
  Container; L2 -> Component; L3 -> Code.
- **Companions:** C4 is diagrams only, on purpose. Pair with **ADRs** (rationale
  the diagram can't express) and a **software guidebook / arc42** (text). See the
  `living-documentation` skill.

## Common mistakes (model-level)

- **C4 implies no process or team structure.** It's wrong to say "a BA owns
  Context, an architect owns Container". C4 describes a system at different
  zooms; it says nothing about who does what or how you deliver.
- **Cramming the whole story onto one diagram** (all components of an app, all
  microservices at once). Split into several focused diagrams **at the same
  level of abstraction**, each with a specific focus (a functional area, a
  bounded context, a use case). High cognitive load = nobody reads it.
- **Modelling tools beat diagramming tools** for this: model once, visualise
  many ways (this is the Structurizr DSL argument).
