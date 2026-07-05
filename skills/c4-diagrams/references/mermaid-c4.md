# Mermaid C4 (default format)

Mermaid is the **default** because a fenced ` ```mermaid ` block **renders inline
on GitHub, GitLab, VS Code, Obsidian and most markdown viewers with zero
toolchain** - ideal when the output lands in a README or PR. Its syntax is
PlantUML-compatible and well-represented in training data, so it's easy to get
right.

**Caveats (know these before choosing Mermaid):**

- **Officially experimental** - the docs warn syntax may change.
- **Weak layout** - no real layout algorithm; position is driven by
  **statement order** and `UpdateLayoutConfig($c4ShapeInRow, $c4BoundaryInRow)`.
  Directional `Lay_U/D/L/R` hints are **not supported**. Sprites, tags, links,
  and legends are unfinished.
- Therefore: **keep diagrams small-to-medium.** For a large multi-level model or
  fine layout control, switch to Structurizr DSL or C4-PlantUML
  ([structurizr-dsl.md](structurizr-dsl.md)).

Reference: [mermaid.js.org/syntax/c4.html](https://mermaid.js.org/syntax/c4.html).

## Chart types

`C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`. One chart
type per diagram (this enforces "one abstraction level per diagram").

## Elements

```text
Person(alias, "Label", "Optional description")
Person_Ext(alias, "Label", "Description")

System(alias, "Label", "Description")
System_Ext(alias, "Label", "Description")
SystemDb(alias, "Label", "Description")
SystemQueue(alias, "Label", "Description")

Container(alias, "Label", "Technology", "Description")
ContainerDb(alias, "Label", "Technology", "Description")
ContainerQueue(alias, "Label", "Technology", "Description")
Container_Ext(alias, "Label", "Technology", "Description")

Component(alias, "Label", "Technology", "Description")
ComponentDb(alias, "Label", "Technology", "Description")
```

Boundaries group same-level elements:

```text
Enterprise_Boundary(alias, "Label") { ... }
System_Boundary(alias, "Label") { ... }
Container_Boundary(alias, "Label") { ... }
Boundary(alias, "Label", "type") { ... }
```

## Relationships

```text
Rel(from, to, "Label", "Optional technology/protocol")
BiRel(a, b, "Label", "Protocol")
Rel_Up / Rel_Down / Rel_Left / Rel_Right   %% hints; honoured weakly
```

Always give a specific verb-phrase label; put the protocol in the tech slot on
inter-container relationships.

## Layout tuning

```text
UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

Controls wrapping only. To change placement, reorder the statements.

## Worked example - System Context

````markdown
```mermaid
C4Context
    title System Context diagram for Internet Banking System

    Person(customer, "Personal Banking Customer", "A customer of the bank with personal accounts")
    System(banking, "Internet Banking System", "Lets customers view accounts and make payments")
    System_Ext(mainframe, "Mainframe Banking System", "Stores core banking information")
    System_Ext(email, "E-mail System", "Microsoft Exchange")

    Rel(customer, banking, "Views accounts and makes payments using", "HTTPS")
    Rel(banking, mainframe, "Gets account information from, and makes payments using", "XML/HTTPS")
    Rel(banking, email, "Sends e-mail using", "SMTP")
    Rel(email, customer, "Sends e-mails to", "SMTP")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```
````

## Worked example - Container

````markdown
```mermaid
C4Container
    title Container diagram for Internet Banking System

    Person(customer, "Personal Banking Customer", "A customer of the bank")
    System_Ext(mainframe, "Mainframe Banking System", "Core banking")
    System_Ext(email, "E-mail System", "Microsoft Exchange")

    System_Boundary(c1, "Internet Banking System") {
        Container(spa, "Single-Page App", "JavaScript, React", "Delivers banking features in the browser")
        Container(mobile, "Mobile App", "Kotlin, Swift", "Delivers banking features on mobile")
        Container(web, "Web Application", "Java, Spring MVC", "Serves the SPA and static content")
        Container(api, "API Application", "Java, Spring Boot", "Provides banking features over JSON/HTTPS")
        ContainerDb(db, "Database", "PostgreSQL", "Stores users, accounts, audit")
    }

    Rel(customer, web, "Visits bigbank.com using", "HTTPS")
    Rel(customer, spa, "Views accounts and makes payments using", "HTTPS")
    Rel(customer, mobile, "Views accounts and makes payments using")
    Rel(web, spa, "Delivers to the browser")
    Rel(spa, api, "Makes API calls to", "JSON/HTTPS")
    Rel(mobile, api, "Makes API calls to", "JSON/HTTPS")
    Rel(api, db, "Reads from and writes to", "JDBC")
    Rel(api, mainframe, "Makes API calls to", "XML/HTTPS")
    Rel(api, email, "Sends e-mail using", "SMTP")
```
````

Note every container carries a technology, every relationship a specific label,
inter-container hops name a protocol, and the boundary keeps it to one level.

## Rendering

- **Best path:** paste the fenced block into the README/PR/issue - GitHub renders
  it, no tooling. This is the whole point of choosing Mermaid.
- **Standalone image:** `scripts/render.sh diagram.mmd` -> uses `mmdc`
  (`@mermaid-js/mermaid-cli`) if installed, else `pnpm dlx @mermaid-js/mermaid-cli`
  (pulls headless Chromium on first run).
- Always render and read errors before presenting. Common gotchas: a stray
  comma, a missing quote, or `Rel` referencing an undefined alias.
