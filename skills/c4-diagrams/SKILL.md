---
name: c4-diagrams
description: >
  C4 architecture diagrams - System Context, Container, Component, Code, plus
  Dynamic and Deployment views (Simon Brown's C4 model). Use whenever the user
  wants to draw, update, or review an architecture diagram, model or visualise a
  system's structure, reverse-engineer C4 from an existing codebase or repo,
  write or edit a Structurizr DSL workspace (workspace.dsl), or produce a Mermaid
  / PlantUML / D2 architecture diagram - even when they don't say "C4" (e.g.
  "diagram how this service fits together", "draw the containers for this repo").
---

# C4 diagrams

Draw software architecture as a small set of **maps at different zoom levels**,
one abstraction per map. Based on Simon Brown's [C4 model](https://c4model.com)
and *Software Architecture for Developers*. The point is communication: each
diagram tells a different part of the same story to a different audience, and
each one stands on its own without a narrative.

## Not this skill (use instead)

- **Domain modelling, ports/adapters, error design** -> `architecture` skill.
  This skill draws and verifies the model; that one decides *what* to model.
- **Decision rationale, ADRs, keeping docs from rotting** -> `living-documentation`
  skill. C4 shows static structure; the *why* belongs in ADRs/a guidebook.
- **Behaviour: business processes, workflows, state, data models.** C4 is static
  structure only. Use BPMN / UML state / sequence / ER instead.

## The core in 30 seconds (sticky rules)

1. **Only two diagrams for most systems: System Context + Container.** Add
   Component only when it earns its place; Code almost never. Don't draw all four
   by default.
2. **A Container is an app or data store that must be *running*** - a web app,
   SPA, mobile app, serverless function, database schema, S3 bucket. **NOT a
   Docker container. NOT a JAR/DLL/module/package.** Deployment is a separate
   diagram.
3. **A Component runs *in the same process* as its container** - a grouping of
   code behind an interface. Not independently deployable, not a folder/package.
   Describe components by **responsibility**, never one box per source folder.
4. **One abstraction level per diagram.** Never put components next to external
   systems, or classes on a container diagram.
5. **Evidence-first when deriving from code.** Every element traces to something
   you read. Label **Observed vs Inferred**. Never invent actors, external
   systems, or components. Misleading diagrams are worse than none.
6. **Every diagram needs a title + legend. Every element needs type +
   technology + a one-line responsibility. Every arrow is one-directional,
   specifically labelled, with a protocol on inter-container lines.** No bare
   "Uses" / "DB" / "Backend".
7. **A diagram you haven't rendered is not done.** Render it, read the errors,
   fix, repeat.

## Decision tree

```text
Designing a NEW system from a spec?
  -> Elicit first (actors, external systems, boundaries), then model.
     Hand design questions to the `architecture` skill. references/deriving-from-code.md (greenfield branch)

Documenting an EXISTING repo?
  -> Evidence-first discovery loop. references/deriving-from-code.md

Which diagrams?
  -> Context + Container always. Component only for the 1-2 containers where it
     helps. Deployment when runtime topology matters. Dynamic sparingly, for one
     tricky flow. Code almost never. references/c4-model.md

Which output format?
  -> Default: Mermaid C4 (renders inline on GitHub/GitLab/VS Code, zero setup).
     references/mermaid-c4.md
  -> Serious multi-level model, long-lived docs, or repo already has a
     workspace.dsl: Structurizr DSL as single source of truth, export to render.
     references/structurizr-dsl.md
  -> Escape hatches: D2 (best local layout) / C4-PlantUML (richest notation).
     references/structurizr-dsl.md#alternatives
```

## The C4 abstractions (condensed)

`Person` -> uses -> `Software System` -> made of `Container`s (apps + data
stores) -> made of `Component`s -> made of `Code`.

| Diagram | Scope | Shows | Audience |
|---|---|---|---|
| **System Context** | one system | the system + its users + external systems | everyone |
| **Container** | one system | the apps/data stores inside + how they talk | technical |
| **Component** | one container | components inside that container | developers |
| **Code** | one component | classes/functions (usually generated) | developers |
| *Deployment* | one environment | instances mapped onto infrastructure | technical/ops |
| *Dynamic* | one use case | numbered runtime collaboration | technical |
| *System Landscape* | an org/dept | portfolio map of many systems | everyone |

Full definitions, the container/component landmines, and when to use each:
[references/c4-model.md](references/c4-model.md).

The metadata + relationship + legend contract, colours, and anti-patterns:
[references/notation-and-quality.md](references/notation-and-quality.md).

## Workflow

1. **Pick the entry mode** - derive-from-code or greenfield
   ([references/deriving-from-code.md](references/deriving-from-code.md)).
2. **Model the smallest useful set** - Context + Container first. Resist scope
   creep. Split a crowded diagram into several focused ones at the same level
   rather than cramming.
3. **Choose format** - Mermaid by default; Structurizr DSL when it's a real
   multi-level model or one already exists.
4. **Render and verify** - `scripts/render.sh <file>` picks the renderer, runs
   it, and reports errors. Fix until it renders cleanly. For Mermaid destined
   for a README/PR, note it renders natively on GitHub with no tooling. Use
   `scripts/example-workspace.dsl` as a known-good Structurizr DSL smoke test
   or sample when checking local renderer setup.
5. **Self-review against the quality checklist**
   ([references/notation-and-quality.md](references/notation-and-quality.md#quality-checklist))
   before presenting.

## Sibling skills - point, don't duplicate

- **`architecture`** - domain modelling, boundaries, ports/adapters, error
  design. This skill draws/verifies; that one designs.
- **`living-documentation`** - ADRs, guidebook, keeping docs in sync with
  reality. Hand decision rationale there; C4 diagrams show structure only.
- The `Software Architecture for Developers` "software guidebook" (Context,
  Functional Overview, Quality Attributes, Constraints, Principles, Software
  Architecture, External Interfaces, Code, Data, Infrastructure, Deployment,
  Operation & Support, Decision Log) is the text companion these diagrams slot
  into. arc42 is the other common one.
