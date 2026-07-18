# Contract-compat gates — command patterns and CI placement

Every tool here except vacuum diffs the current API surface against a
**baseline** (a git ref, a published schema, or a committed report), so they
belong in CI or a pre-push hook — never pre-commit, where no baseline is
naturally available. Spec governance (vacuum, below) is the baseline-free
exception and can run pre-commit. Gate on the non-zero exit in every case.

## Protobuf — buf breaking

```bash
# Diff against the main branch of the same repo
buf breaking --against '.git#branch=main'

# Against a remote module / another clone
buf breaking --against 'https://github.com/org/repo.git#branch=main'
```

Rule categories form a strictness ladder — pick per compatibility promise:

- `FILE` (default) — generated-code compatibility, per-file location
- `PACKAGE` — generated-code compatibility, movable between files
- `WIRE_JSON` — wire + JSON compatibility only
- `WIRE` — wire compatibility only (loosest)

```yaml
# buf.yaml
breaking:
  use:
    - FILE
```

## OpenAPI — oasdiff

```bash
# Fail CI on breaking changes (ERR level); WARN adds potential-breaking
oasdiff breaking base.yaml revision.yaml --fail-on ERR
```

Levels: `ERR` (breaking), `WARN` (potentially breaking), `INFO` (everything).
In CI the baseline is usually the file at the target branch:

```bash
git show origin/main:openapi.yaml > /tmp/base.yaml
oasdiff breaking /tmp/base.yaml openapi.yaml --fail-on ERR
```

## OpenAPI spec governance — vacuum

oasdiff gates *breaking changes* against a baseline; spec governance gates the
spec's *shape and style* with no baseline — required descriptions/examples,
naming conventions, versioning rules, banned patterns — so it is the one gate
in this file that can run pre-commit. The ruleset standard is Spectral's
(`spectral:oas` built-ins plus house rules in one shared ruleset, so API
conventions stop living in review memory). Run it with **vacuum** — single Go
binary, Spectral-ruleset compatible, OpenAPI 3.0/3.1/3.2:

```bash
# non-zero exit at or above --fail-severity (default: error)
vacuum lint -r house-ruleset.yaml --fail-severity error openapi.yaml
```

Spectral itself still ships patches but is investment-light and silently
ignores OpenAPI 3.2 constructs — reach for it only where its JS plugin
ecosystem is already wired in.

## GraphQL — graphql-inspector

```bash
# Non-zero exit when at least one breaking change is found
graphql-inspector diff 'git:origin/main:schema.graphql' schema.graphql
```

For a federated graph, use Cosmo's `wgc subgraph check` instead — composition
errors only surface across the whole supergraph.

## Rust — cargo-semver-checks

```bash
cargo semver-checks            # diffs rustdoc JSON against the released baseline
```

Auto-run by release-plz on library crates (drives the version bump). Not
exhaustive — it proves the breaks it finds, not the absence of breaks. Being
merged into `cargo publish` upstream.

## TypeScript — @microsoft/api-extractor

The committed `.api.md` report is the baseline. Dev regenerates it; CI
compares and fails on any unreviewed public `.d.ts` surface change:

```bash
api-extractor run --local      # dev: rewrite the report, commit the diff
api-extractor run              # CI: non-zero exit if report differs — no --local
```

## Consumer-driven contracts — Pact

`can-i-deploy` is the deploy-time gate: "has every consumer verified this
version?" (The contract-testing method itself lives in the `testing` /
`event-driven-architecture` skills.)

```bash
pact-broker can-i-deploy \
  --pacticipant my-service --version "$GIT_SHA" \
  --to-environment production \
  --retry-while-unknown 12 --retry-interval 10
```

`--retry-while-unknown` polls while verification results are pending; it does
not retry connection errors.

## Gap: Avro / JSON Schema

No standalone single-binary gate exists. The production path is a schema
registry's compatibility check (e.g. Confluent's, per-subject
BACKWARD/FORWARD/FULL modes) invoked at CI time against the registry.
