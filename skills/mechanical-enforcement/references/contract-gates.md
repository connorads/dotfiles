# Contract-compat gates - command patterns and CI placement

Every tool here except vacuum diffs the current API surface against a
**baseline** (a git ref, a published schema, or a committed report), so they
belong in CI or a pre-push hook - never pre-commit, where no baseline is
naturally available. Spec governance (vacuum, below) is the baseline-free
exception and can run pre-commit. `pyright --verifytypes` is baseline-free too,
but it scores a *built and installed* wheel, so it stays in CI for the other
reason. Gate on the non-zero exit in every case.

## Protobuf - buf breaking

```bash
# Diff against the main branch of the same repo
buf breaking --against '.git#branch=main'

# Against a remote module / another clone
buf breaking --against 'https://github.com/org/repo.git#branch=main'
```

Rule categories form a strictness ladder - pick per compatibility promise:

- `FILE` (default) - generated-code compatibility, per-file location
- `PACKAGE` - generated-code compatibility, movable between files
- `WIRE_JSON` - wire + JSON compatibility only
- `WIRE` - wire compatibility only (loosest)

```yaml
# buf.yaml
breaking:
  use:
    - FILE
```

## OpenAPI - oasdiff

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

## OpenAPI spec governance - vacuum

oasdiff gates *breaking changes* against a baseline; spec governance gates the
spec's *shape and style* with no baseline - required descriptions/examples,
naming conventions, versioning rules, banned patterns - so it is the one gate
in this file that can run pre-commit. The ruleset standard is Spectral's
(`spectral:oas` built-ins plus house rules in one shared ruleset, so API
conventions stop living in review memory). Run it with **vacuum** - single Go
binary, Spectral-ruleset compatible, OpenAPI 3.0/3.1/3.2:

```bash
# non-zero exit at or above --fail-severity (default: error)
vacuum lint -r house-ruleset.yaml --fail-severity error openapi.yaml
```

Spectral itself still ships patches but is investment-light and silently
ignores OpenAPI 3.2 constructs - reach for it only where its JS plugin
ecosystem is already wired in.

## GraphQL - graphql-inspector

```bash
# Non-zero exit when at least one breaking change is found
graphql-inspector diff 'git:origin/main:schema.graphql' schema.graphql
```

For a federated graph, use Cosmo's `wgc subgraph check` instead - composition
errors only surface across the whole supergraph.

## Rust - cargo-semver-checks

```bash
cargo semver-checks            # diffs rustdoc JSON against the released baseline
```

Auto-run by release-plz on library crates (drives the version bump). Not
exhaustive - it proves the breaks it finds, not the absence of breaks. Being
merged into `cargo publish` upstream.

## TypeScript - @microsoft/api-extractor

The committed `.api.md` report is the baseline. Dev regenerates it; CI
compares and fails on any unreviewed public `.d.ts` surface change:

```bash
api-extractor run --local      # dev: rewrite the report, commit the diff
api-extractor run              # CI: non-zero exit if report differs - no --local
```

## Python - griffe check and pyright --verifytypes

Two gates over one surface, and neither sees the other's half. `griffe check`
diffs *structure* against a baseline ref; `pyright --verifytypes` scores the
*types* the built wheel actually ships. The wheel/sdist shape gates that pair
with them live in the Publishing section of `references/python.md`.

```bash
# structure: exit 0 = no breakage; exit 1 = breakages OR the command itself failed
uvx --from griffe griffe check -s src mypkg -a v1.2.0

# a PyPI release as the baseline instead of a git ref. griffe 2.2.0 opens a temp
# dir inside its platformdirs cache without creating that cache first, so a fresh
# machine dies with FileNotFoundError; pre-create it
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}/griffe"   # bare macOS: ~/Library/Caches/griffe
uvx --from 'griffe[pypi]' griffe check mypkg -b mypkg==2.0 -a mypkg==1.0
```

It reports removed public objects, removed/renamed/moved parameters, changed
parameter kinds, changed defaults, newly-required parameters and removed class
bases. It is **blind to every annotation change**: on griffe 2.2.0 a parameter
going `list[Order]` to `list[str]`, and a return widening to `Widget | None`,
both exit 0. Only *deleting* a return annotation is reported, as
`Return types are incompatible: Widget -> None`, which reads as a type change
and is not one. So griffe gates shape; `--verifytypes` and review gate types.

Four wiring facts:

- **Findings go to stderr.** `griffe check ... > report.md` writes an empty file
  and reads as a clean run. Redirect `2>` or `2>&1`.
- **`-a` defaults to the latest git tag**, so `actions/checkout` needs
  `fetch-depth: 0` and `fetch-tags: true`. A clone with no tags dies with
  `RuntimeError: Could not create git worktree`.
- **Exit 1 does not mean "the API broke".** A wrong `-s` search path, a missing
  package and an untagged clone each traceback with exit 1 as well, so the exit
  code alone cannot separate a broken gate from a broken API. Assert on the
  stderr text where that distinction matters.
- **It imports the baseline ref's code** from a temporary worktree when static
  resolution fails. Pass `-X` / `--no-inspection` to keep it static.

`-f github` / `-f azdo` emit CI annotations (`azdo` needs griffe >= 2.1.0).

**There is no baseline or ratchet**, so a legacy library is all-or-nothing: every
historic breakage fires on the first run and no suppression file exists. griffe's
own CI runs its API check with `nofail=True` inside a `continue-on-error` job -
informational, not a gate. Do the same on an unclean history and tighten to a
gate once the report is empty.

**`griffe dump` is not the Python `.api.md`.** The obvious workaround - commit a
dump, diff it in CI, as api-extractor does - does not survive contact. The dump
is deterministic byte-for-byte, but it carries `lineno`/`endlineno` on every
member, absolute `filepath` values that differ between a dev checkout and CI,
and every private member; `griffe dump --help` exposes no flag to suppress any
of the three. So the report churns on edits that are not API changes: adding one
private helper to a five-symbol package moved 11 of the dump's 102 lines. A
committed report is therefore bespoke here: `griffe dump` piped through
a normaliser that strips `lineno`/`endlineno`/`filepath` and filters to `__all__`.

```bash
# types: exit 0 only at 100% completeness, exit 1 at anything below
uvx --with dist/mypkg-1.2.0-py3-none-any.whl \
  basedpyright --verifytypes mypkg --ignoreexternal
```

Type completeness is what a `py.typed` marker promises a consumer: every symbol
reachable from the public interface has a known, non-inferred type. One
unannotated public function in an 18-symbol package scores 94.4% and exits 1;
annotating it scores 100% and exits 0.

- **Resolution beats configuration.** `--verifytypes` finds the package only in
  the environment reached through the `python3` on `PATH`, and it *ignores*
  `--pythonpath` (which the same binary honours for ordinary analysis). The
  `uvx --with <wheel>` form above works because uv puts its ephemeral env first
  on `PATH`; `PATH=<venv>/bin:$PATH uvx basedpyright ...` does not, because uvx
  re-prepends its own bin. The other working shape is a venv holding the
  non-editable install, on `PATH`, running its own `basedpyright`.
- **An editable install measures the source tree, not the wheel.** Where the
  backend writes a path-style `.pth` (hatchling and setuptools both do under
  `uv pip install -e`), pyright resolves straight into `src/` and scores it - so
  a `py.typed` missing from the *wheel* is invisible. Install the built artefact.
- **A broken environment is indistinguishable from a missing marker.** Both
  print `Package directory: ""`, `error: No py.typed file found` and
  `Type completeness score: 0%`. Guard on
  `.typeCompleteness.packageRootDirectory != ""` before trusting the score, or a
  misconfigured job reports a catastrophic regression on a complete package.
- **Do not gate on `errorCount` or `generalDiagnostics`; both are inverted.** A
  real completeness failure gives `errorCount: 0` and `generalDiagnostics: []`;
  the broken-environment case gives `errorCount: 1` and one diagnostic. Gate on
  the exit code, or on the score.
- **There is no threshold flag and no baseline.** It is 100% from day one;
  basedpyright's `--writebaseline` does not apply. A percentage floor has to be
  built by hand:

```bash
uvx --with dist/mypkg-1.2.0-py3-none-any.whl \
  basedpyright --outputjson --verifytypes mypkg --ignoreexternal |
  jq -e '.typeCompleteness.packageRootDirectory != "" and
         .typeCompleteness.completenessScore >= 0.95'
```

The score is also gameable in the direction upstream documents: renaming a
symbol to a leading underscore drops it out of the public interface entirely, so
100% proves the declared surface is typed, not that the surface is right.

## Consumer-driven contracts - Pact

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
