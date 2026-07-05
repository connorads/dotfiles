# Deriving C4 from code (and the greenfield branch)

Two entry modes. Both end at the same rule: **every element traces to evidence,
and guesses are labelled as guesses.**

## Mode A - derive from an existing repo (the common case)

An evidence-first, 6-phase loop. Read before you draw; a repo is **not** the same
as the whole system.

### 1. Scope

- Read the README, top-level layout, and any existing architecture docs.
- Decide what this repo **is**: a product, one service, a library, infra-as-code.
- Decide what's **in scope vs out** - a monorepo may hold several containers; a
  single service may be one container inside a larger system you don't own.
- Name the software system and its boundary before anything else.

### 2. Containers - read the manifests and infra

Look for runnable apps and data stores. Evidence sources:

- **Manifests:** `package.json`, `pom.xml`/`build.gradle`, `go.mod`,
  `Cargo.toml`, `requirements.txt`/`pyproject.toml`, `*.csproj`, `Gemfile`.
- **Runtime/infra:** `Dockerfile`, `docker-compose.yml`, k8s manifests, Helm
  charts, Terraform, `serverless.yml`, Procfile, systemd units.
- **What to extract:** frontends (SPA/mobile/desktop), backend APIs, workers,
  scheduled jobs, CLIs, plus data stores - databases, caches, queues, buckets,
  file stores. Each running app or data store is a **container**; each gets a
  technology.
- Remember: a JAR/module/package is **not** a container; an SPA **is** its own
  container.

### 3. Interactions - direction, protocol, sync/async

Read the wiring, not just the file tree:

- HTTP clients and servers, SDK/API calls, DB access layers/ORMs, message
  publish/subscribe, gRPC stubs, auth middleware, cron/schedulers.
- Config and `.env`/secrets for external endpoints and credentials (don't echo
  secret values).
- Capture for each edge: **direction**, **protocol/technology**, **sync vs
  async**, and any **trust boundary** crossed.

### 4. External systems + actors - infer, then ask

- Infer external systems from dependencies and clients: auth (Auth0/Cognito),
  payments (Stripe), email (SES/SendGrid), cloud services you *don't* own,
  observability, third-party APIs.
- Infer actors from UI labels, routes, and role/permission checks.
- **Ask, don't invent** personas or systems you can't evidence. An owned S3
  bucket/RDS schema is a **container**, not an external system.

### 5. Component breakdown - only where it helps

- Do this for the **1-2 most important containers**, not all of them.
- Group by **responsibility** (controllers, services, repositories, adapters,
  gateways) - **never** one box per source folder, never file-by-file.
- Cap the element count; if it's crowded, it's the wrong level or needs
  splitting by functional area.

### 6. Output

Present: the **scope statement**, the **diagrams** (Context + Container first),
an **assumptions list**, an **Observed vs Inferred** annotation on anything
uncertain, and **open questions** for the human.

### Large repos

Don't cram the whole tree into context. Use an **AgentDoc-style rollup**: write
dense per-directory summaries first, then roll them up into containers/components.
Delegate broad discovery to a subagent so the main context stays focused.

## Mode B - greenfield design from a spec

There's no code to read, so **elicit before modelling**. Gather:

- **For Context:** who are the users/actors, what external systems are involved,
  what's the system boundary. (Business-level - non-technical stakeholders help.)
- **For Container/Component:** the intended tech stack, the major runnable pieces,
  the data stores. (Technical detail.)

Hand genuine **design** questions (domain boundaries, ports/adapters, error
strategy, chosen patterns) to the **`architecture`** skill - this skill draws and
verifies the result; it doesn't design it. Capture the **decisions and rationale**
as ADRs (see `living-documentation`), not on the diagram.

## What to ask a human (both modes)

Reserve questions for what code/spec can't reveal:

- Production runtime topology (for a Deployment diagram).
- Real personas / who actually uses each entry point.
- Team ownership and the true system boundary.
- Whether a managed service sits **inside** the system boundary (container) or
  **outside** it (external system).

## Then: format, render, verify

Choose Mermaid ([mermaid-c4.md](mermaid-c4.md)) or Structurizr DSL
([structurizr-dsl.md](structurizr-dsl.md)), render with `scripts/render.sh`, and
run the quality checklist in
[notation-and-quality.md](notation-and-quality.md#quality-checklist) before
presenting.
