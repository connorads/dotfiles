# AGENTS.md

# Tools

## mise

- Prefer to use [`mise`](https://mise.jdx.dev/walkthrough.html) to manage runtime and tool versions
- If using GHA use `jdx/mise-action@v3` (`mise generate github-action` to create a new one)

## GitHub

Use `gh` CLI to access and update issues and PRs etc. Use `--body-file - <<'EOF'` for multi-line text.
If the user mentions a GitHub issue, remember to close the issue if you fix it - mention "Closes #NO" in commit message.

## Multiline input

- Never use `$(cat <<'EOF' ... EOF)` for commit/PR text.
- Use stdin flags instead:
  - `git commit -F - <<'EOF' ... EOF`
  - `gh ... --body-file - <<'EOF' ... EOF`
- If stdin is awkward, use repeated `-m` flags.

# Guidance

## Secrets

Do not echo secrets. If checking format or prefix, use `printenv VAR_NAME | head -c 5`.

## Assumptions and research

Don't assume, check: It's important to do research to get the latest code and information.

- Web search: Use exa to search the web for current information, documentation, discussions, issues, and solutions.
- Code search: Grep the codebase. You can also clone other repos like libraries from GitHub into /tmp and explore.

Prefer to *use subagents* for research as to not pollute the context with lots of distracting tokens.

## Communication and writing

- Use British English: analyse, favourite, realise, colour etc.
- Be concise: Interactions, PRs and commit messages - be concise and sacrifice grammar for the sake of concision.

## Git

- **MVP commits**: each commit is the smallest complete, coherent change — code + tests + wiring together. Would you send it as a standalone PR? If not, it's too small.
- **Revert test**: could this commit be reverted cleanly, removing exactly one meaningful thing? If reverting orphans code or breaks something unrelated, it's not self-contained.
- **Review test**: can a reviewer understand this commit without reading other commits in the series? If context is missing, fold the pieces together.
- Split when the *concern* changes, not the *file type* — "add feature X with tests" is one commit; "refactor auth then add feature X" is two.
- Renames/moves in a separate commit from content changes (git rename detection breaks otherwise) — but include reference/import updates so the build passes.
- Commit after each coherent unit. Don't batch everything into one mega-commit at the end.
- Plan steps map to commits when they pass the revert and review tests. Multiple small steps may merge into one commit; one large step may split into several.

## Selective Staging

`git hunks list` shows diff hunks with unique IDs. `git hunks add <id>` stages specific hunks non-interactively.
Use for granular commits when a file contains changes for multiple concerns.

## Design approach

- Design before building: sketch domain types and key workflows before writing implementation
- Make the change easy, then make the easy change — restructure first if the code fights you
- 3X awareness: know whether you're exploring, expanding, or extracting. Explore = lighter touch, experiment fast. Expand/extract = full discipline (types, tests, architecture)

## Architecture

- **Functional core, imperative shell**: pure business logic in the centre (no I/O, no side effects, no mutation); thin imperative shell at the edges (HTTP handlers, DB access, CLI parsing)
- **Impureim sandwich**: gather data (impure) → make decisions (pure) → act on results (impure). Challenge assumptions that effects must be interleaved — fetch eagerly, decide purely
- **Values at boundaries**: pass simple values between components, not objects with behaviour
- **Ports and adapters**: define interfaces (ports) in the application's own terms; implement with technology-specific adapters. If tests need real infrastructure, you're missing a port. Name ports by purpose ("for ordering") not technology ("for postgres")
- **Walking skeleton**: start new projects with the thinnest end-to-end slice proving the architecture works — one use case traversing all layers
- For substantial domains, apply full DDD and ports/adapters. For simple scripts/tools, strong types and impureim sandwich are sufficient

## Domain modelling

- Strongly typed code: no `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- Make illegal states unrepresentable: model domain with ADTs/discriminated unions; if state can't exist, code can't mishandle it
- Wrapper types for primitives: EmailAddress, OrderId, CustomerId as distinct types — not raw strings/numbers
- Parse don't validate: transform untyped input at boundaries into typed structures; never re-check validity internally
- Ubiquitous language: code names must match domain language; no generic names (data, info, manager, helper)
- Workflows as functions: each use case is a function — command in, events out; type signatures document the workflow
- Bounded contexts: separate models per domain area with explicit translation at boundaries
- Quality abstractions: consciously constrained, pragmatically parameterised, doggedly documented

## Observability

- Design for observability: instrument at system boundaries (HTTP, DB, queues), prefer structured logging over unstructured, include context (request ID, operation, entity)

## Commits, comments and docs

- Document the *why* and *intent*, the what and how can usually be deduced but the *why* and *intent* will get lost otherwise.
- If you're ever unsure why the user might be doing something then ask - they will appreciate your questioning and clarify.

## Testing

**TDD is the default discipline**, not a suggestion:

- Red-green-refactor: write a failing test, make it pass with simplest code, refactor. This is the rhythm
- Tests are design feedback: if it's hard to test, the design is wrong — redesign, don't add mocks
- Test business behaviour through public APIs, not implementation details

**Testing taxonomy** — architecture dictates where tests go:

| Layer | What | How | Volume |
|-------|------|-----|--------|
| Pure core | Business logic, domain rules | Unit tests with real values, no test doubles. Property-based tests for large input spaces | Most tests |
| Adapter contracts | Each adapter fulfils its port | Fakes (in-memory port implementations) for fast tests; few integration tests per adapter against real infra | Some tests |
| Composition | Wiring works end-to-end | Walking skeleton first, then key user journeys through composed system | Few tests |
| E2e | Critical paths through real UI/CLI | CLI: run commands. Web: playwright. Critical journeys only | Minimal |

**No mocks** — the architecture eliminates the need. Pure core needs no doubles; adapters use fakes (in-memory implementations of the port interface) or real infrastructure. If you reach for a mock, reconsider the design.

**Property-based testing**: use for pure functions where the input space is large or combinatorial — describe the properties that must hold, not individual examples.

## Have you finished?

- Has our change been tested and validated? Also no linting or formatting errors?
- Did we make a big change to functionality or architecture? Consider updating any `.md` file where appropriate and/or writing an ADR
- Did we have any realisations or learnings? Consider updating `AGENTS.md` or `CLAUDE.md`
