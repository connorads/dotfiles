# Structurizr DSL (serious multi-level C4) + alternatives

Use **Structurizr DSL** - Simon Brown's own canonical implementation - when the
task is a **real multi-level model** (Context + Container + Component from one
source), when the docs are **long-lived**, or when the repo **already has a
`workspace.dsl`**. Its killer property: **model once, generate many consistent
views.** The Context/Container/Component nesting *is* the model, so you
**cannot** mix abstraction levels and views can't drift from each other - the two
things agents get wrong when hand-authoring separate Mermaid diagrams.

Trade-off: **nothing renders DSL natively** (not GitHub, not VS Code preview). It
always needs a JVM + Docker or an export step. So when you emit DSL you **own the
render path** - never leave raw DSL assuming it will render.

Reference: [docs.structurizr.com/dsl/language](https://docs.structurizr.com/dsl/language).

## File shape

```text
workspace "Name" "Description" {
    model {
        # people, software systems, containers, components, relationships
    }
    views {
        # one view per diagram + styles/themes
    }
}
```

## Model elements

```text
u = person "Personal Banking Customer" "A customer of the bank"

banking = softwareSystem "Internet Banking System" "..." {
    web    = container "Web Application"  "Serves the SPA"            "Java, Spring MVC"
    spa    = container "Single-Page App"  "Banking features in-browser" "React"
    api    = container "API Application"  "Banking features over JSON" "Java, Spring Boot" {
        signin = component "Sign In Controller" "Handles auth" "Spring MVC"
        accounts = component "Accounts Controller" "Serves accounts" "Spring MVC"
    }
    db     = container "Database" "Stores users, accounts" "PostgreSQL" {
        tags "Database"
    }
}

mainframe = softwareSystem "Mainframe Banking System" "Core banking" {
    tags "External"
}
```

Nesting `container` inside `softwareSystem`, and `component` inside `container`,
**is** the C4 hierarchy. Assign identifiers (`api = container ...`) to reference
them in relationships and views.

## Relationships

```text
u   -> web  "Visits bigbank.com using" "HTTPS"
spa -> api  "Makes API calls to"       "JSON/HTTPS"
api -> db   "Reads from and writes to" "JDBC"
api -> mainframe "Makes API calls to"  "XML/HTTPS"
```

Third field = specific label; fourth = technology/protocol.

## Views (one per diagram)

```text
views {
    systemContext banking "Context" {
        include *
        autoLayout lr
    }
    container banking "Containers" {
        include *
        autoLayout lr
    }
    component api "API-Components" {
        include *
        autoLayout
    }
    dynamic banking "SignIn" {
        u -> web "Signs in"
        web -> api "Forwards credentials"
        autoLayout
    }
    deployment banking "Production" "Prod" {
        include *
        autoLayout
    }

    styles {
        element "External" { background #999999 }
        element "Database" { shape cylinder }
    }
    # theme default
}
```

Give each view an explicit key (`"Context"`) - auto-generated keys aren't stable
across edits and manual layout can be lost. `include *` means "this scope + its
directly-connected neighbours". `autoLayout [tb|bt|lr|rl]` turns on Graphviz
layout.

## Extras worth knowing

- `group "Name" { ... }` draws a boundary around same-level elements.
- `!include <file|dir|url>` splices DSL fragments (modular files).
- `!docs <path>` attaches Markdown/AsciiDoc; `!adrs <path>` attaches ADRs.
- `deploymentEnvironment`, `deploymentNode` (nestable), `infrastructureNode`,
  `containerInstance` build deployment views. **A Docker container is a
  deployment node here** - which is where "Docker" legitimately belongs in C4.
- Tag-driven styling: you style **tags**, not individual elements.

## Rendering (you must pick one)

No paid cloud needed. On this machine `java` and `docker`/`colima` are present
but the Structurizr CLI is not installed, so **Docker is the reliable path**:

```bash
# Export DSL -> Mermaid (then embed/render as Mermaid), or -> SVG/PNG:
docker run --rm -v "$PWD:/work" -w /work structurizr/cli \
    export -workspace workspace.dsl -format mermaid

# Interactive local preview (diagrams + docs + ADRs) at http://localhost:8080:
docker run --rm -it -p 8080:8080 -v "$PWD:/usr/local/structurizr" structurizr/lite
```

`scripts/render.sh workspace.dsl` wraps the export path. Exporting **parses and
validates** the DSL, so a clean export *is* your verification step - a broken
model fails the export.

**Style caveat:** element shapes/icons and some relationship styling only render
fully in Structurizr's own renderer. If the final target is exported
Mermaid/PlantUML, keep styling minimal.

**Note (Feb 2026 "vNext"):** `structurizr-cli` and "Structurizr Lite" are being
consolidated into one `structurizr` tool with subcommands (`local`, `server`,
`export`, `validate`, `inspect`, ...) documented at
[docs.structurizr.com/commands](https://docs.structurizr.com/commands). The DSL
language is unchanged. The Docker images above still work; prefer the `structurizr`
tool's `local`/`export` subcommands if installed.

## Alternatives

Offer these as escape hatches when Mermaid/DSL don't fit. See
`scripts/render.sh` for the render dispatch.

### D2 - lightest local render, best layout

- **When:** you want a clean local PNG/SVG with good auto-layout and no
  JVM/browser. `brew install d2` (or `mise use -g aqua:terrastruct/d2`), then
  `d2 in.d2 out.svg`. Engines: dagre (default), elk; TALA (architecture-tuned) is
  paid.
- **Cost:** **no official C4 macros** - you hand-model C4 with generic
  containers/shapes. Define a small convention (a `person`/`system`/`boundary`
  class block) and reuse it. Not GitHub-native (export to image).

### C4-PlantUML - richest, most canonical notation

- **When:** you need directional hints (`Rel_U/D/L/R`), sprites, tags, and proper
  legends. `!include` the
  [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML) stdlib; macros
  `Person/System/Container/Component`, `*_Ext`, `SystemDb/SystemQueue`,
  `*_Boundary`, `Rel/BiRel/Rel_*`.
- **Render:** a public/self-hosted **PlantUML server** via URL (zero local
  install), or local `plantuml.jar` + Graphviz (`brew install plantuml graphviz`).
  Not GitHub-native.

### likeC4 - model-once, many interactive views

- **When:** a large/long-lived architecture where you want a navigable model and
  are willing to add Playwright for image export. Exports to Mermaid/D2/dot.

### IcePanel

- Hosted collaborative C4 modelling (GUI). A **human hand-off** destination, not
  an agent-emitted text format.
