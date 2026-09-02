# Mechanical Enforcement - Python

Per-stack rules for Python: Ruff format + lint, type checking, complexity, dead
code, dependencies, boundaries, purity, testing config and publishing gates.
Routed from the picks table and rules-catalogue index in `SKILL.md`.

## Contents

- [Picks](#picks)
- [Ruff format + lint](#ruff-format--lint)
- [Type checking](#type-checking)
- [Complexity](#complexity)
- [Dead code](#dead-code)
- [Dependencies](#dependencies)
- [Boundaries](#boundaries)
- [Purity](#purity)
- [Testing](#testing)
- [Publishing](#publishing)
- [Gate integrity](#gate-integrity)
- [Maintenance posture](#maintenance-posture)

## Picks

One owner per job: Ruff for per-file lint and the attribute-level effect bans in
the pure core, import-linter for the module graph, ast-grep for every other
scoped or call-shaped rule, basedpyright for the type contract. Idiom belongs to
the `python` skill, test strategy to `testing`, coverage to `test-coverage`,
dependency audits to `supply-chain-hardening`. Drop-ins:
`references/python-ruff.toml`, `references/python-typecheck.toml`,
`references/python-purity.toml`, `references/python-ast-grep.yml`,
`references/python-pytest.toml`, `references/python-deptry.toml`,
`references/python-vulture.toml`, `references/python-import-linter.toml`.

Take the first tool named for a job and reach past it only when that tool
cannot express the rule. Ruff replaces Black, isort, Flake8 and most of Pylint,
but not `R0801` duplicate-code (a cross-file pass its per-file parallel model
cannot do), `R0902` too-many-instance-attributes, or `C0302` too-many-lines,
declined upstream as incompatible with the formatter -
[Complexity](#complexity) names the fallbacks, and complexipy covers cognitive
complexity because Ruff has no rule for it. basedpyright `recommended` is the
blocking type gate; pyrefly (Rust) is the edit-time pre-filter for speed,
always `-c` with `preset = "strict"`; ty is a watch at 0.0.x -
[Type checking](#type-checking). deptry is the declared-versus-imported half of
what knip and cargo-machete do elsewhere, vulture at `min_confidence = 100`
the unreachable-code half; tach is opt-in for `[[interfaces]]` alone -
[Boundaries](#boundaries). Every gate here fails open in some configuration -
[Gate integrity](#gate-integrity).

The typical hook-tier mapping:

```text
tier 1 (format/fix)     → trailing-whitespace, newlines, typos, ruff check --fix, ruff format
tier 2 (lint/gate)      → ruff check (incl. TID251 purity bans), ast-grep scan, lint-imports (no filenames, --no-cache), validate-pyproject[all], uv lock --check, gitleaks, yamllint, check-merge-conflict
tier 3 (typecheck)      → basedpyright recommended (the gate); pyrefly -c + strict as the edit-time pre-filter
tier 4 (deps/dead code/test) → deptry (inside the project env), vulture at min_confidence=100 after baseline cleanup, pytest -c pyproject.toml with the strict block (`references/python-pytest.toml`)
CI / pre-push            → griffe check, basedpyright --verifytypes, check-wheel-contents, check-manifest, twine check --strict, clean-venv smoke import, uv audit, licensecheck --zero, opengrep --error
```

## Ruff format + lint

Ruff is the default Python formatter and linter, replacing Black, isort, Flake8,
pyupgrade and most Pylint-style low-level checks. Use its curated defaults plus
deliberate additions through `extend-select`; `select` replaces the defaults
entirely, and `ALL` is never a baseline. Pin one minor release with
`required-version`: Ruff's
[versioning policy](https://docs.astral.sh/ruff/versioning/) reserves stable
default-set changes for minor releases, so a minor bump is the explicit review
point. See `references/python-ruff.toml`.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Stable baseline checks | Ruff defaults + `extend-select = ["E", "F", "UP", "B", "SIM", "I", "RUF"]`, with one pinned minor | Curated cross-family correctness checks plus the full-family coverage the 0.16 default set drops | `select` replaces the defaults; use it only when that is deliberate. |
| Formatter owns wrapping | Ruff format + ignore `E501` | Formatter/linter disagreement on line length | Re-enable `E501` only for a hard line-length gate. |
| Safe fixes only by default | `ruff check --fix --show-fixes`; no `--unsafe-fixes` in hooks/CI | Mechanical rewrites changing semantics | Run unsafe fixes as reviewed one-offs. |
| Suppressions carry a rule code | `PGH003` (bare `# type: ignore`) + `PGH004` (bare `# noqa`) | A blanket suppression that also hides every diagnostic added to that line later | `PGH003` covers `# type: ignore` and `# pyright: ignore`, not `# ty: ignore`, and a trailing prose comment slips past it. It is a first line, not the gate - `enableTypeIgnoreComments = false` is. |
| No bare `Any` in signatures | `ANN401` alone, not the `ANN` family | `def f(x: Any) -> Any` | Signatures only: `v: Any = 1` and `dict[str, Any]` pass clean. Strictly weaker than basedpyright's `reportExplicitAny`/`reportAny`, so select it only where basedpyright `recommended` is not the gate. |
| Entities stay hashable | `PLW1641` (eq-without-hash) | A hand-written `__eq__` dropping the inherited `__hash__`, so every set/dict membership check raises `TypeError` | Purely syntactic: a decorator-generated `__eq__` (bare `@dataclass`, `attrs.define`) is invisible and broken the same way. `__hash__ = None` in the body is the correct suppression. |
| No module-global rebinding | `PLW0603` (global-statement) | Hidden mutable module state that makes tests order-dependent | The legitimate case is a lazily-initialised singleton - the shape the composition root replaces. |
| Text I/O declares its encoding | `PLW1514` (unspecified-encoding) | `open()` resolving to the locale encoding, so a file that reads on a UTF-8 Mac raises `UnicodeDecodeError` in a POSIX-locale container | Preview: needs the exact code under `preview = true` + `explicit-preview-rules = true`, or ruff prints `Selection PLW1514 has no effect because preview is not enabled` and passes. |
| No stdlib name shadowing | `A005` (stdlib-module-shadowing) | A first-party `secrets.py` or `types.py` that `import secrets` resolves to instead of the stdlib | Flags top-level modules only; it reaches a package under a src layout only with `[lint.flake8-builtins] strict-checking = true`, which the drop-in sets. A mis-set `src` is a silent no-op. |
| Absolute imports only | `TID252` with `ban-relative-imports = "all"` | Relative imports that make a module's real position in the graph unreadable | Pairs with the boundary tier: import-linter and TID251 both resolve relatives, but a reader cannot. |
| Log the traceback | `TRY400` (error-instead-of-exception) | `logging.error(...)` inside an `except` block, dropping the traceback from the record | One rule out of the policy-heavy `TRY` family; no false-positive class observed. |
| Async tasks are held | `RUF006` (asyncio-dangling-task) | `asyncio.create_task(...)` with no stored reference, so the task is garbage-collected mid-flight | |
| Security subset, named | The 25 codes in `references/python-ruff.toml`, plus `S102` | Hardcoded secrets, pickle, `eval`/`exec`, weak hashes and TLS, `shell=True`, string-built SQL, template autoescape off | Never select the `S` prefix: it lands `S101` on every assert, `S607` on every `["git", "status"]` and `S603` on the correct argv-list `subprocess.run`, which is why teams disable `S` wholesale. `S108` (`/tmp`) is deliberately off. |
| Tests get test-shaped ignores | per-file ignores for `tests/**` | Lints fighting idiomatic tests | `S105`/`S106`/`S107`, `ANN401`, `C901`, `PLR0913`/`PLR0915`/`PLR0917`/`PLR0904`; `PT` is enabled under `tests/**` only, through one negated entry. An ignore for a code the config does not select is accepted silently and relaxes nothing, so the list tracks what is selected. Never add `TID` here: it drops `TID252` across the whole test tree. |
| Generated/migration files stay explicit | `exclude` for generated trees; per-file ignores for migrations | Generated output obscuring real failures | Ignore whole generated trees; relax migrations narrowly. |

- **The 413-rule default set is an expansion and a contraction**: `E401 E402 E701 E702 E703 E711 E712 E713 E714 E721 E731 E741 E742 E743 F403 F405 F406 F722` sit outside it, so `extend-select = ["E", "F"]` is what restores comparison-to-None, lambda assignment, ambiguous names and star imports.
- **Three families read as covered and are not**: `DTZ` is all 10 by default but only 3 under `preview = true`, `LOG` misses `LOG004`/`LOG007`, and `G` misses `G001`-`G004`, the f-string and `.format()` half. Genuinely covered: `PIE`, `T10`, `EXE` bar `EXE003`, and the mutable-defaults set `B006`/`B008`/`RUF008`/`RUF009`/`RUF012`. Worth adding once a project is clean: `PTH`, `ARG`, `TC001-003` (a silent no-op in a file without `from __future__ import annotations`), `PERF`, `T20`, `ERA001`, `INP001`, `PLR2004`, `SLOT`, `RSE102`; treat `D`, `ANN`, `PL`, `TRY`, `FBT`, `TD` and `FIX` as policy-heavy and take the single rules named above.
- **`preview = true` swaps the default set, and `explicit-preview-rules` does not guard that door** - it governs prefix expansion inside `select`. Eight stable rules leave (`S102 DTZ001 DTZ005 DTZ006 DTZ007 DTZ011 DTZ012 DTZ901`), 45 unrequested preview rules arrive under `explicit-preview-rules = true` and 89 without it, and diagnostics print rule *names* not codes; the template answers with `preview = true` for the five preview complexity rules, `"DTZ"` and `"S102"` back through `extend-select`, and `output-prefer-rule-codes = true`.
- **A preview family selected by prefix gates nothing and says nothing**: under both preview settings `--select DOC` exits 0 clean while `--select DOC501` fires, so name every preview rule by exact code.
- **`RUF100` judges a `noqa` against the rules enabled in that run**, so a narrowed `--select X,RUF100 --fix` step deletes legitimate suppressions for rules it did not select; run it only under the full config.
- **`RET505-508` and `PLR0911` argue with each other** - one pushes toward guard clauses, the other counts returns against you.
- **`D` without `[lint.pydocstyle] convention`** warns that `D203`/`D211` and `D212`/`D213` are incompatible and disables one of each pair for you.
- Suppress with `# ruff: ignore[CODE] reason` for one logical line and paired `# ruff: disable[CODE]` / `# ruff: enable[CODE]` for a range; `ruff check --select CODE --add-ignore` records scoped debt for bulk adoption.
- Rejected: `N818` (an `Error` suffix on every exception, against the `python` skill's "name them for the business outcome"), `DOC501` (a docstring entry per `raise`), `PERF203` (a silent no-op at py312), `EM101` (fires on `raise OutOfStock("sku-123")`).

## Type checking

**basedpyright `recommended` is the single blocking gate.** It is basedpyright's
own default, so the config pins the mode rather than switching anything on and a
future default change becomes a visible edit. Exit codes: 0 clean, 1 any error
*or* warning (`recommended` sets `failOnWarnings = true`), 2 fatal, 3 config
parse error, 4 bad parameter. It enables 94 of 95 rules and blocks on every one.
See `references/python-typecheck.toml`. The rules carrying an idiom the `python`
skill states in prose:

| Idiom | Rule | Notes |
|---|---|---|
| No bare `Any`, anywhere | `reportAny`, `reportExplicitAny` | `reportExplicitAny` bans the literal `Any` in any annotation position; `reportAny` bans *using* a value whose type is `Any`, including inferred `Any` from untyped dependencies. `reportAny` is the highest-volume rule in the set on real code and the usual reason a project reaches for a baseline. basedpyright-only. |
| Tagged unions matched exhaustively | `reportMatchNotExhaustive` | Fires when a `match` over a closed set omits a case. Complements `assert_never`, which needs a `case _:` to exist; this one needs it absent. Keep both. |
| Errors as values: a `Result` must be consumed | `reportUnusedCallResult` | The only mechanical "you ignored the return value" gate in Python. It fires on neither a `None`- nor an `Any`-returning call, so an untyped boundary launders it. The escape hatch, `_ = f()`, is exactly the marker a reviewer wants. Absent from `strict`. |
| Public interface is declared, not implied | `reportPrivateUsage`, `reportPrivateLocalImportUsage`, `reportPrivateImportUsage` | These enforce the *re-export* half; import-linter enforces the *layer* half. `reportPrivateLocalImportUsage` covers first-party packages and does not depend on a `py.typed` marker at all - the marker matters only to `reportPrivateImportUsage`, the installed-third-party twin. Neither stops a deep import that bypasses the package root. |
| No import cycles | `reportImportCycles` | At **error** severity under `recommended` and off under `strict`, so a project on that mode has a cycle gate it may not know about and tightening the mode loses it. File-level only: a package-to-package cycle with no two-file loop produces nothing. |
| `@override` on every override | `reportImplicitOverride`, `reportIncompatibleMethodOverride` | Deleting or renaming a base method becomes a type error rather than a silently dead subclass method. `reportImplicitOverride` is absent from `strict`. |
| Deprecation is a build signal | `reportDeprecated` | `@warnings.deprecated("use new_fn")` turns every remaining call site into a diagnostic - the mechanical form of the expand-migrate-contract deprecation step. Stdlib from 3.13; `typing_extensions.deprecated` below that, and a checker that cannot resolve `typing_extensions` sees no decorator and the whole gate vanishes. |
| Suppressions expire | `reportUnnecessaryTypeIgnoreComment`, `reportUnnecessaryComparison`, `reportUnnecessaryIsInstance`, `reportUnnecessaryCast` | Dead defensive code the type system proves impossible, plus an ignore comment that suppresses nothing. `reportUnnecessaryIsInstance` is the false-positive generator: a runtime guard at an optimistic boundary is correct code the checker thinks is dead. |
| State is established in the constructor | `reportUninitializedInstanceVariable`, `reportPropertyTypeMismatch`, `reportUnannotatedClassAttribute` | `reportUninitializedInstanceVariable` sits at error severity (with `reportIncompatibleMethodOverride` and `reportImportCycles`), so it is usually first to go red. ORM/attrs classes that assign outside `__init__` are the false-positive class. All three absent from `strict`. |
| Targeted suppression only | `enableTypeIgnoreComments = false` + `reportIgnoreCommentWithoutRule` | The pair does different jobs: the first makes *every* `# type: ignore` inert, targeted forms included; the second flags a rule-less `# pyright: ignore`. Both implied by `recommended`. |

- **`strict` is not a superset of `recommended`; only `all` is.** Twenty-four rules stop blocking under `strict`, including every `Any` and every suppression-discipline rule, and four non-report settings flip: `failOnWarnings` true to false, `enableTypeIgnoreComments` false to **true**, `deprecateTypingAliases` and `strictGenericNarrowing` true to false - that second flip is a correctness hole, since a file returning `1` from a `-> str` function under a bare `# type: ignore` exits 1 under `recommended` and 0 under `strict`. `all` differs from `recommended` by one rule (`reportIncompatibleUnannotatedOverride`) and relabels its 49 warnings as errors; both fail on warnings, so they behave alike at the exit code.
- **`pyrightconfig.json` silently outranks `pyproject.toml`**: one containing `{"typeCheckingMode":"basic"}` makes a `recommended` project report `0 errors` and exit 0 with no message, and editors and templates like to write it. Pass `-p pyproject.toml` - a missing named file exits 3, so the step fails closed - and never let both forms exist.
- **Upstream pyright is not a fallback for this gate**: it ignores a `[tool.basedpyright]` table entirely, and under `[tool.pyright]` it answers `recommended` and every basedpyright-only key with a notice that leaves the exit code alone, so a misconfigured section exits 0 on clean code.
- **Adoption ratchet.** `--writebaseline` records today's diagnostics in `.basedpyright/baseline.json`, matched on (path, rule, column) - line-insensitive but count-aware. Baseline mode is a **CLI flag**, `--baselinemode=discard`; a `baselineMode` config key exits 3 as unrecognised. With `CI=true` it defaults to lock and a stale baseline exits 3, and fixed entries are pruned only on an otherwise-clean run. The other vehicles: `mypy | mypy-baseline`, exact-edge `ignore_imports` for import-linter (self-expiring), and `--suppress-errors` plus `--remove-unused-ignores` for pyrefly, never its baseline. Budget a one-off sweep on arrival from mypy: every `# type: ignore` goes inert and `reportUnnecessaryTypeIgnoreComment` cannot see a disabled mechanism, so nothing asks you to delete them.

**pyrefly is the edit-time and pre-commit pre-filter**, and an acceptable gate
for untyped script code. Invoke it as `pyrefly check -c <config>`, always: with
no config it falls back to preset `basic` and exits 0 on a tree holding two real
type errors, while `-c` on a missing file is a fatal error and exit 1 - the
fail-closed form. Set `preset = "strict"` and name kinds in `[errors]`;
`preset = "all"` turns red on unchanged code at a minor bump. An unknown kind is
fatal and an unknown top-level key warns, but `"warn"` severity is the silent
one: it reports `0 errors (1 warning not shown)` and exits 0 where `= true`
exits 1, the exact inverse of basedpyright `recommended`. It does not read
`[tool.basedpyright]`, cannot gate private usage, import cycles, property type
mismatch, unused expressions or `--verifytypes`, and has no rule-code
requirement on suppressions, so `# pyrefly: ignore-errors` silences a file.

**ty is a watch**: still 0.0.x with explicitly unstable diagnostics, so any pin
rots immediately, and on a shared probe corpus it finds 6 diagnostics against
`recommended`'s 23. An unknown rule name in `[tool.ty.rules]` is a
`warning[unknown-rule]` and exits 1, so a typo fails loudly; its misses are
unimplemented checks, indistinguishable from "checked and clean". Re-evaluate at
1.0.

**mypy, for a repo already on it.** `--strict` alone covers little of the above;
add the opt-in codes:

```sh
mypy --strict --enable-error-code=exhaustive-match,explicit-any,deprecated,\
explicit-override,ignore-without-code,redundant-expr,unused-ignore,mutable-override src
```

It flags extra keys under a PEP 728 `closed = True` `TypedDict`, but has no
analogue of `reportUnusedCallResult`, `reportUnusedExpression`,
`reportPrivateUsage`, `reportImportCycles`, `reportUninitializedInstanceVariable`
or `reportPropertyTypeMismatch`, so errors-as-values is unenforceable on it.

**A whole-file rule override is the hole no checker closes.** A first line of
`# pyright: reportReturnType=false` silences that rule for the whole module under
`recommended`: no config key disables the mechanism,
`reportIgnoreCommentWithoutRule` does not see it, no ruff rule flags it, and
`# pyrefly: ignore-errors` does the same to pyrefly at exit 0. Mode comments are
not the hole - `# pyright: basic` and `# pyright: standard` do **not** lower a
`recommended` project, `# pyright: off` is an unknown directive and itself an
error, and `# pyright: strict` in one file is the per-file adoption ratchet:

```sh
! git grep -nE '^# *(pyright: *report[A-Za-z]+ *= *false|pyrefly: *ignore-errors|mypy: *ignore-errors)' -- '*.py'
```

## Complexity

The cross-stack argument and the numbers live in `references/complexity.md`; the
config block is `references/python-ruff.toml`. This is the rule map. Ruff's
413-rule default set contains **no** complexity rule, so every code below must be
named explicitly - and five of them are preview-only.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Branch count | `C901` + `[lint.mccabe] max-complexity = 15` | Functions with more paths than a test suite covers | 10 is McCabe's original and Ruff's default; 15 is the cross-stack number. **Never port a threshold from radon** - see below. |
| Nesting depth | `PLR1702` (preview) + `max-nested-blocks = 4` | Arrow code, which unbraced Python makes easy to write and hard to see | Counts `with` / `for` / `while` / `try` / `if`. Tightened from the default 5 to the cross-stack number. The only stable alternative, `WPS220`, hard-codes its limit and drags in flake8. |
| Flat branch arms | `PLR0912` + `max-branches = 12` | God functions that grew one `elif` per requirement | Keep the default: deliberately looser than the branch cap, so the two catch different shapes (wide-but-shallow dispatch). |
| Function size | `PLR0915` + `max-statements = 50` | Functions no reviewer reads end to end | **The only function-length gate Ruff has** - there is no line-based function rule and no file-length rule. Roughly 60-90 formatted lines. |
| Parameter count | `PLR0913` + `max-args = 5` | Signatures that need a comment to call correctly | `self` / `cls` excluded; `@typing.override` methods exempt. |
| Positional-argument count | `PLR0917` + `max-positional-args = 3` | Two same-typed positionals swapped silently at the call site | Stable since ruff 0.16.0 (preview on 0.15.x, where selecting it is a silent no-op). Keyword-only args after `*` do not count, so the fix is a `*` in the signature, not a refactor. |
| Compound conditions | `PLR0916` (preview) + `max-bool-expr = 5` | `if a and b and c and d and e and f` | Counts the boolean expressions in one `if`. |
| Over-broad `try` | `PLW0717` (preview) + `max-statements-in-try = 5` | An `except` that cannot tell which of six statements threw | The mechanical form of "narrow the try block"; no other Python linter gates it. Retry and transaction wrappers are the false-positive class. |
| God classes | `PLR0904` (preview) + `max-public-methods = 20` | Classes carrying too many responsibilities | The nearest proxy for pylint's `R0902` (too-many-instance-attributes), which Ruff does not implement. Relax in tests - a `TestCase` subclass is a bag of public methods by design. |
| Local-variable count | `PLR0914` (preview) + `max-locals = 15` | Functions carrying too much state at once | Already generous. Do not lower it toward WPS's 5; named intermediates aid readability in numeric code. |
| Return count | `PLR0911` + `max-returns = 6` | An `if x == "a": return 1` chain that wants to be a dict | The weakest rule here and folklore-adjacent - it descends from single-exit doctrine, which guard clauses deliberately reject. Adopt it last, and drop it rather than raise it if it fights good code. |
| Cognitive complexity | `complexipy --max-complexity-allowed 15 <paths>` | The read-difficulty half: a flat 12-branch dispatch and a 4-deep nest score alike under C901 | Ruff has no cognitive-complexity rule and will not get one until rule categorisation is settled (astral-sh/ruff#2418, open since 2023, `needs-decision`). complexipy implements the nesting-weighted Campbell metric, defaults to 15, exits 1, and ships the only Python complexity baseline that exists. Install `pipx:complexipy`. Run it **instead of** tightening C901. |
| Duplicate code | `pylint --disable=all --enable=duplicate-code` | Copy-paste divergence: the second copy never gets the bug fix | Ruff does not implement `R0801` and structurally cannot - it is per-file and parallel, while R0801 is a whole-project cross-file pass. Raise `min-similarity-lines` to 8; the default 4 floods on imports and boilerplate. **Do not use the standalone `symilar` binary as a gate** - it ends in an unconditional `sys.exit(0)`. |
| File length | `radon raw -s`, or a `wc -l` step | A Python tree drifting while TS and Rust gate file size | pylint's `C0302` has no Ruff equivalent and is **declined upstream** as incompatible with the formatter, so this fallback is permanent rather than a stopgap. |

- **Preview rules need `explicit-preview-rules`, not blanket preview**: with preview off, `PLR1702` warns `Selection PLR1702 has no effect` and then passes, so set both settings and name each code, since a bare `PLR` prefix then enables none of them.
- **complexipy resolves its config against the invocation directory and does not walk up**, so running it from a subdirectory silently uses threshold 15 and finds no `complexipy-snapshot.json`, disabling grandfathering while the plain threshold check still fires. Pin the working directory in the hook step.
- **`complexipy --diff <ref>` is a threshold gate, not a no-regressions gate**: a function going 3 to 4 under a limit of 15 passes. The 6.0.0 scoring conformance pass raised most scores, so a threshold tuned on 5.x starts failing, and the v7 CLI drops `--output-json` / `--output-csv` / `--ratchet`.
- **Ruff's C901 counts fewer constructs than radon** - no per-boolean-operator increment, and radon counts comprehensions and `assert` higher - so a threshold ported from radon is materially stricter in Ruff. Pick one and tune in it.

## Dead code

Three tools, three scopes, and one gap. Ruff owns unused imports (`F401`) and
unused locals (`F841`), per file, already in the default set. Vulture owns what a
per-file pass cannot see. Nothing owns unused public exports.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Unreachable code and unsatisfiable conditions | `vulture` at `min_confidence = 100` | A statement after `return`/`raise`, and `if False:` blocks | That is the whole of what confidence 100 gates, plus unused function arguments (reported as "unused variable"), which `ARG001-005` already covers; an unused class, method, constant or function reports nothing. |
| Whole-repo analysis | Run `vulture` from the repo root; do not pass only changed files | False confidence from incomplete reachability | Include `src`, `tests`, scripts and the whitelist file. |
| Whitelist intentional dynamic use | `vulture_whitelist.py` checked into the repo | Broad excludes hiding real dead code | Prefer a whitelist over `ignore_names` / `ignore_decorators`; exclude only generated/vendor/build trees. |

- **Vulture exits 3 on findings, not 1** (0 clean, 1 invalid input, 2 bad CLI args), so a wrapper testing `[ $? -eq 1 ]` passes a dirty tree. See `references/python-vulture.toml`.
- Run at confidence 60 with a committed whitelist only as a periodic audit: that threshold surfaces the unused function, class, attribute and module-level variable findings, and the false-positive volume that made 100 the default.
- **Unused `__all__` entries have no gate in any Python tool** - neither vulture at any confidence nor `dead` reports a name exported and referenced nowhere, both treating `__all__` membership as a use, and Ruff's `F822`, `PLE0604`, `PLE0605`, `RUF022` and `RUF068` only check the shape of the list. This is the one knip capability Python has no answer for; state it rather than shipping vulture as an equivalent.
- `deadcode` (albertas/deadcode) is **rejected**: it prints DC01-DC04 findings and exits 0 with no flag that changes it. `dead` (asottile/dead) is a watch - it exits 1 and models reachability from git-tracked files - but it needs a git work tree, has no config file, and shares the `__all__` blind spot.

## Dependencies

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Manifest matches the import graph | `deptry src` | `DEP001` an import with no declared dependency, `DEP002` a declared dependency nothing imports, `DEP003` an import satisfied only transitively, `DEP004` a dev-group dependency imported from production code, `DEP005` a stdlib module declared as a dependency | See `references/python-deptry.toml`. |
| Lockfile is current | `uv lock --check` | `pyproject.toml` edited without re-locking | 12ms - cheaper than most formatters. `uv sync --locked` in CI. |
| Manifest is schema-valid | `uvx --from 'validate-pyproject[all]' validate-pyproject pyproject.toml` | A malformed PEP 508 specifier, a bogus SPDX licence expression, a misspelled PEP 621 key | Baseline-free, so it is the one gate here that belongs at pre-commit. |
| Licence compatibility | `licensecheck --zero` | A dependency whose licence is incompatible with the project's own | Needs network and re-queries PyPI per package, so CI only. The closest Python has to cargo-deny's `[licenses]`, because it evaluates compatibility rather than string-matching. |
| Known vulnerabilities | `uv audit` | Advisories against the locked set | Detective layer. Owned by `supply-chain-hardening`; named here because the Python row otherwise has no audit gate and the obvious search result is dead. |

- **`deptry` reads distribution metadata off its OWN `sys.path`**, so it must be installed *in* the environment it analyses; without that it guesses module names from package names and a project declaring `pyyaml`/`beautifulsoup4` and importing `yaml`/`bs4` produces six issues, all false. Put it in the dev group and run it under `uv run`, or `uv run --with 'deptry==<pin>' deptry .`; prepending the venv to `PATH`, setting `VIRTUAL_ENV`, a global shim and a bare `uvx` all fail the same way, which is why deptry's own pre-commit hook uses `language: system`.
- **`uv sync --frozen` is not a drift gate**: on a `pyproject.toml` that gained a dependency after locking, `uv lock --check` and `uv sync --locked` exit 1 while `--frozen` installs from the stale lock and exits 0. Both are also spelled by `UV_FROZEN` / `UV_LOCKED`, so an inherited variable swaps a step's semantics.
- **`validate-pyproject` without its extras is a silent no-op**: on `dependencies = ["requests >>= 2.0"]` the bare invocation prints `Valid file` to stdout and exits 0, sending only a "Could not find an installation of `packaging`" notice to stderr where a hook runner swallows it, while `[all]` reports ``project.dependencies[0] must be pep508`` and exits 1. Use `[all]` rather than `--with packaging`, which leaves the trove-classifiers check open.
- Rejected: `uv-secure` (final release 2026-04, superseded by `uv audit`); `fawltydeps` (dormant, a strict subset of deptry, exits 3 not 1); `creosote` (deptry's `DEP002` quarter only). `pip-licenses` is a coarse second choice for inventory and a GPL/AGPL denylist: it string-matches unnormalised licence fields and evaluates no SPDX expression, so `Apache-2.0 OR BSD-2-Clause` cannot be satisfied by allowing Apache-2.0, and `--partial-match` "fixes" that unsoundly by passing on any listed substring - an `AND` expression the same way. Python has no cargo-deny equivalent.

## Boundaries

Three tiers, in this order. Each covers what the one above cannot.

**1. import-linter owns the module graph.** Declare `layers`, `forbidden`,
`independence`, `protected` and `acyclic_siblings` contracts in `pyproject.toml`
and gate with `lint-imports` (exit 1 on a broken contract). Two properties make
it the pick: `layers`, `forbidden` and `independence` gate transitive import
*chains* natively (an A to B to C path breaks a forbidden A-to-C contract), and
every contract includes `if TYPE_CHECKING:` imports by default, so type-only
coupling cannot launder a boundary. See `references/python-import-linter.toml`.

- `protected` (2.5) allow-lists the importers of a module - "reachable only through the approved gate" - and `as_packages` defaults to true, so listing a parent protects a subtree and an allow-list entry opens one. Direct edges only.
- `acyclic_siblings` (2.6) gates cycles at *package* granularity, also on direct edges only, and its removal suggestion is a greedy feedback-arc approximation truncated at five per package, so it is a starting point rather than a minimum set; basedpyright's `reportImportCycles` covers the file-level half.
- `broken_contract_guidance` (2.14) attaches the fix instructions to the contract itself - the mechanical form of "the *why* lives with the rule".
- `exhaustive = true` fails when a *direct child* of a container has no declared layer, so it gates one level deep and a `_private.py` beside the layers counts as undeclared; ignores are bare tail names matched against every container, so `utils` exempts `billing.utils` and `shipping.utils` alike. A containerless contract carrying it is a hard config error, refused before checking; the silent no-op is the inverse, `exhaustive_ignores` with no `exhaustive = true`, which skips the check and reports `KEPT`.
- A misspelled *exact* module name errors loudly while a *wildcard* matching nothing is reported `KEPT`; a wildcard in `ignore_imports` inverts that and is worse, erroring under the default `unmatched_ignore_imports_alerting = "error"` while it matches nothing and then going blind once it matches one edge - which is why the exact edge is the ratchet vehicle.
- `lint-imports` takes **no filenames** (exit 2), so a hook step must not be fed staged paths, and `.import_linter_cache` is not concurrency-safe: pass `--cache-dir` or `--no-cache` per parallel step, and gitignore it.
- `exclude_type_checking_imports` is **global, not per-contract**, so "domain may import infra types but not infra values" needs two config files and two runs.

**2. Ruff TID251/TID253 own the direct edge, in the editor** - a per-ban message
at the import site, live while typing. `TID251` bans an API by dotted path;
`TID253` (`banned-module-level-imports`) permits the `if TYPE_CHECKING:` import
and bans the module-level one, the only single-config way to express the
value/type split, though it bans at module level rather than "except under
TYPE_CHECKING", so a function-level import satisfies it while staying a real
runtime dependency. Both see `TYPE_CHECKING` and resolve relative imports.

- **One scope per TID251 config**: `banned-api` is a single flat global map and `per-file-ignores` toggles the whole code, so a root config banning both `app.infra` and `app.schemas` with `"!app/domain/**" = ["TID251"]` reports the domain violation and **silently drops** the second. Give TID251 one job - here, the pure core's effect bans; layer bans go to import-linter, sink bans to ast-grep.
- **Nested `ruff.toml` per layer is a rejected route**: `--config <file>` disables hierarchical discovery, so a tree reporting TID251 findings under `ruff check src` reports `All checks passed!` under `--config ruff.toml`, and hook steps routinely pass `--config`. The `<KEY>=<VALUE>` form does not; `--isolated` does.

**3. ast-grep owns every other scoped or call-shaped rule** - bare builtins, SQL
sinks, `unittest.mock` in tests, assertion-free tests, dataclass slots - via
`files:` scoping and `severity: error`. See `references/python-ast-grep.yml`.

- **Escape hatch: grimp in pytest.** For the "A may reach B, but never through C" shape import-linter has no contract for, write a pytest test over the graph (grimp is already an import-linter dependency), asserting with `chain_exists` rather than `find_shortest_chains`, which misses a longer bypassing chain.
- **tach is opt-in for `[[interfaces]]` only** - consumers may import only the names a module's `expose` globs name, the one job import-linter has no primitive for. Everything else is weaker: it checks direct declared edges only, so with `domain to application` and `application to infra` declared it reports `All modules validated!` while domain reaches infra, and it launders barrel re-exports. `tach check --dependencies` or `--interfaces` **disables every other check**, `tach sync` auto-allowlists existing imports, and `deprecated` edges print a warning and exit 0.
- **Reject PyTestArch as a boundary gate.** In a positive-control `src/`-layout fixture, version 4.0.1 and main derived `src.myproject.*` module names instead of the importable `myproject.*` names. After addressing the filesystem-derived names, it caught direct and `TYPE_CHECKING` imports but allowed `domain -> application -> infra` under a domain-must-not-import-infra rule. Its fluent pytest DSL, positive dependency assertions, layer aggregation and PlantUML support do not compensate for direct-edge enforcement that permits transitive dependency laundering. Use import-linter for standard contracts and its underlying Grimp graph from pytest for predicates the contract vocabulary cannot express. Do not maintain a second import graph without a concrete project requirement.
- `pytest-archon` remains preferable to PyTestArch for test-local direct-edge assertions, but does not replace import-linter's transitive contracts. Rejected: `pydeps` (a Graphviz visualiser that exits 0 regardless, printing nothing at all when Graphviz is absent); `pycycle` (prints `No worries, no cycles here!` on a real two-file cycle).

The cross-stack boundary philosophy lives in
`references/architecture-boundaries.md`.

## Purity

Keeping the functional core pure is a two-tool job. **Ruff TID251 resolves
imported names**, so it catches the semantic cases and sees through aliases:
`from datetime import datetime as dt; dt.now()` is flagged. Ban the
ambient-effect call sites - `datetime.datetime.now`, `time.time`,
`random.random`, `random.choice`, `secrets`, `uuid.uuid4`, `os.environ`,
`os.getenv`, `sys.argv` - plus the whole I/O and persistence modules (`requests`,
`httpx`, `subprocess`, `socket`, `sqlalchemy`, `redis`, `logging`, the project's
own `infra` package), scoped with **one** negated `per-file-ignores` entry. See
`references/python-purity.toml`.

```toml
[lint.per-file-ignores]
"!src/myproject/{domain,core}/**" = ["TID251"]
```

- Ban the module-level convenience functions, not the module: banning `random` outright is a false positive on the injected-Rng idiom, since `random.Random(seed)` is what the core should hold. Same for `pathlib` - a `Path` is a pure value; ban `.read_text()` / `.write_text()` in ast-grep.
- **ast-grep covers what ruff structurally cannot**: `open(...)`, `input(...)`, `breakpoint(...)` and `$P.read_text(...)` are invisible to TID251, which resolves imported names only, while ast-grep is syntax-only and misses the aliased-import case ruff catches. Run both.
- **DTZ is not a purity gate** but clock *hygiene*: `DTZ005` passes `datetime.datetime.now(tz=UTC)`, still an ambient clock read. Only TID251 removes the clock from the core; name DTZ so nobody re-adds it as the gate.
- `ASYNC` goes project-wide, not domain-scoped - the value is in the shell. `extend-select = ["ASYNC"]` adds `ASYNC109`, `ASYNC110`, `ASYNC212`, `ASYNC240` and `ASYNC250` over the 0.16 defaults, the blocking-call half; the family inspects `async def` bodies only, so a sync helper called from a coroutine is invisible.
- **pytest-socket is the runtime backstop**, because a static ban cannot see an adapter that leaked into a "unit" test. Call `disable_socket(allow_unix_socket=True)` from `pytest_configure` in the root `conftest.py`, not `addopts`: `--disable-socket` hooks `pytest_runtest_setup`, so a module-level socket call at collection time passes silently.
- Reaching for `freezegun` or `time-machine` inside the domain suite is itself a purity finding - the production code read the clock. Both are legitimate in the shell and around characterisation tests; prefer `time-machine`.

**Every scoping mechanism here fails open, so ship the canary.** A typo'd glob, a
`warning`-severity ast-grep rule and a nested config under `--config` all exit 0;
sharpest is the cancellation, where two negated `per-file-ignores` entries for
`TID251` make every file match one of them and the gate reports clean. Assert the
ban is still armed *and* still scoped - `--stdin-filename` honours
`per-file-ignores` in both directions, which is what makes the negative half
meaningful:

```sh
printf 'import random\nx = random.choice([1])\n' | ruff check --no-cache --quiet \
  --select TID251 --stdin-filename src/myproject/domain/_canary.py -   # MUST exit 1
printf 'import random\nx = random.choice([1])\n' | ruff check --no-cache --quiet \
  --select TID251 --stdin-filename src/myproject/infra/_canary.py -    # MUST exit 0
```

## Testing

Config lives here; strategy lives in the `testing` skill and thresholds in
`test-coverage`. The drop-in is `references/python-pytest.toml`, which also
carries the hypothesis profiles.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| A floor under every key below | `minversion = "9.1"` | Keys that only warn on an older runner, leaving the whole block decorative | The `strict_*` ini keys land in pytest 9.0, but 9.0.0 through 9.0.3 silently ignore `--strict-markers` and `--strict-config` given inside `addopts` (pytest #14442), which is the fallback anyone reaches for. Exit 4 when unmet. |
| Unregistered marks fail | `strict_markers = true` (ini) | A typo'd `@pytest.mark.slwo` running as a plain test while `-m slow` in CI silently selects nothing | Prefer the pytest-9 ini booleans over the flags: `-o addopts=""` wipes flags in `addopts` but not ini keys. Does not validate `-m` *expressions* - a typo there deselects everything and exits 5. |
| Misspelled config keys fail | `strict_config = true` (ini) | A setting you believe is configured being simply off | Exit 4. Without it but with `filterwarnings = ["error"]`, the same typo surfaces as an `INTERNALERROR` and exit 3, because the config warning precedes the reporter. |
| A fixed xfail fails | `strict_xfail = true` (ini) | An xfail-marked test that has started passing staying marked broken forever | pytest 9.0+; on 8 it is an unknown key. Use it or `xfail_strict` - never both. `--runxfail` disables the whole machinery. |
| An empty matrix fails | `empty_parameter_set_mark = "fail_at_collect"` | `@pytest.mark.parametrize("case", CASES)` where `CASES` came out empty: the whole matrix vanishes, prints one `s`, exits 0 | The default is `skip`. The single largest silent-skip hole pytest ships with. |
| Gate-carrying plugins must be present | `required_plugins = ["pytest-randomly", "pytest-timeout", "pytest-socket>=0.8"]` | A fresh venv or CI image where the gate is *absent* rather than failing | Exit 4. Checks loaded plugins, so `-p no:randomly` fails it. Takes distribution names, not module names. |
| Warnings are defects | `filterwarnings = ["error", ...]` | A forgotten `await` (`RuntimeWarning`), a leaked handle (`ResourceWarning`), a dependency's removal notice - all reported at exit 0 by default | See the ordering note below. |
| No network in unit tests | pytest-socket via `pytest_configure` | An "integration test in disguise" that depends on someone else's uptime | Pair with `--allow-unix-socket`; the bare form breaks asyncio and subprocess plumbing. See Purity. |
| Order independence | pytest-randomly | A test that passes only because an earlier test left state behind | Reseeds `random`, `os.urandom`, faker and numpy per test too. |
| Hangs fail fast | pytest-timeout, `timeout_method` left unset | A deadlock burning the CI job's wall clock with no traceback | The default already resolves to signal on POSIX and thread on Windows; spelling `"signal"` explicitly passes validation on Windows and then raises when it arms the alarm, because `SIGALRM` does not exist there. `signal` reports the timeout and the session continues; `thread` calls `os._exit()`, so later tests never run and no summary prints - safe again under xdist, where it kills one worker. |
| Test modules import cleanly | `--import-mode=importlib` | The `import file mismatch` error from two same-named test modules, and rootdir leaking onto `sys.path` | Removes a failure mode rather than adding a gate. The cost: rootdir never reaches `sys.path`, so a top-level helper module at the project root stops importing, while a `tests.helpers` package import is unaffected. Put shared helpers in an installed package. |
| The summary is readable | `-ra`, never `-q` | Skips, xfails and teardown errors vanishing so a run reads as "N passed" | `-q` also hides pytest-randomly's seed line (no reproducer for an order-dependence failure) and the `configfile:`/`rootdir:` header (the only tell that a stray config has shadowed the gates). |
| Domain errors need a message match | `PT` on test paths + `raises-require-match-for = ["*"]` | `pytest.raises(DomainError)` passing on any instance regardless of message | The default list is the broad builtins only, so a project that models its own errors - what the `python` skill asks for - is ungated. Use `["*"]` or a module glob; a base-class entry does no subclass reasoning and gates nothing. |
| No `mock.patch` on code you own | ast-grep `no-unittest-mock-in-tests` | The ban the `python` skill states in prose | One rule owns both halves: the four `unittest.mock` import forms, and pytest-mock's `mocker`, which it matches as a test parameter and reports at the fixture. `monkeypatch` stays allowed for env, cwd and `sys.path`. There is no conftest gate for mocks. |
| Assertion-free tests | ast-grep `test-without-assertion` | A test that runs code and asserts nothing | No Python linter detects this: none of ruff's rules checks for a *missing* assertion. The rule doubles as a naming convention, since an assertion inside a helper not named `assert*` still flags. |
| Skips carry a reason | the collection guard in `references/python-pytest.toml` | A bare `@pytest.mark.skip` quietly removing coverage | Exit 4, with an `allow_skip` marker as the opt-out. It covers reasonless skips and nothing else. |

- **`filterwarnings` ordering decides whether the gate exists**: later entries take precedence, so `["error", "ignore:vendor is old:DeprecationWarning"]` is correct while a broad entry in that position guts the category - `["error", "ignore::DeprecationWarning"]` exits 0 where the reverse exits 1. Every escape must name a message or a specific class.
- **One escape is mandatory**: pytest-socket 0.8+ calls `warnings.warn()` inside `SocketBlockedError.__init__`, so under warnings-as-errors the `UserWarning` is raised in place of the exception and `pytest.raises(SocketBlockedError)` fails. Add `"ignore:A test tried to use socket:UserWarning"` after `"error"`.
- **pytest reads exactly one config file**: a stray `tests/pytest.ini` (or a `[pytest]` table in `tox.ini`, or `[tool:pytest]` in `setup.cfg`) becomes the rootdir config and every setting in the root `pyproject.toml` disappears, so a suite reporting `1 failed [XPASS(strict)]` reports `1 xpassed` at exit 0. A shadowed rootdir moves `confcutdir` too, so a root `conftest.py` self-check cannot detect it - the assertion has to live outside pytest. Pin `pytest -c pyproject.toml`, which sets rootdir as well, so `--rootdir` adds nothing and inside `addopts` is ignored in silence.
- For hypothesis, register three profiles and give the CI one `derandomize=True`, `deadline=None`, `print_blob=True` - the blob is a paste-able `@reproduce_failure` decorator, byte-identical across runs. Never write `suppress_health_check=list(HealthCheck)`: it disables `HealthCheck.function_scoped_fixture`, the check that catches a function-scoped fixture not reset between generated inputs. Keep a nightly profile at `derandomize=False` so new counterexamples are still found.
- Rejected: `pytest-check` (soft assertions let a test continue into known-invalid state; `check.equal` returns a bool and never raises, so `if check.equal(1, 2):` records a failure *and* takes the wrong branch) - prefer `parametrize` or `pytest-subtests`. `respx` is opt-in behind `pytest-httpx`: bare `@respx.mock` uses the global router with `assert_all_called` off, so an uncalled route passes silently while `@respx.mock()` fails; gate the bare decorator with ast-grep.

## Publishing

Only `validate-pyproject` belongs at pre-commit (see Dependencies). Everything
else runs post-build in CI, against the artefact rather than the source tree.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Wheel contains the package and nothing else | `check-wheel-contents dist/*.whl` | A `tests/` directory shipped at the wheel root, an empty wheel, multiple top-level entries | A wheel force-including `tests/` reports `W005` and `W009`, exit 1. Tighten with `--toplevel <name>`. Config resolves from the **current working directory**, so pin it in the step. Wheels only - it never opens the sdist. |
| sdist matches version control | `check-manifest` | sdist bloat and sdist incompleteness | The only gate for the sdist. Needs a VCS checkout and builds the sdist, so pass `--no-build-isolation` with the backend pre-installed in CI. Run on a clean checkout: untracked build junk reports as a finding. |
| README renders on PyPI | `twine check --strict dist/*` | A `long_description` that fails to render | README rendering only, despite the name: a 3.4 MB sdist that had swallowed 13 unrelated wheels passes it. `--strict` is load-bearing - without it a package with no README at all exits 0 "PASSED with warnings". |
| The wheel installs and imports | clean-venv smoke import, run from outside the tree | A module excluded from the build, a missing `py.typed`, a broken `__init__` re-export, an entry point that does not load | The highest-value gate here - the only one that exercises the artefact as a consumer sees it. |
| Public surface is fully typed | `basedpyright --verifytypes <pkg> --ignoreexternal` | A `py.typed` marker promising more than the wheel delivers | Pass/fail at 100% with no threshold flag; build a floor by hand from `--outputjson` `.typeCompleteness.completenessScore`. It resolves the package from whichever site-packages the first interpreter on `PATH` owns, so install the built wheel **non-editable** into that same environment and assert the printed `Package directory` is not empty - an unresolved package prints `Package directory: ""` and `No py.typed file found`. |
| API breakage is reviewed | `griffe check -s src <pkg> -a <git-ref>` | Removed public objects, removed/renamed/moved parameters, changed defaults, newly-required parameters, removed base classes | Pointer and CI placement in `references/contract-gates.md`. |

The smoke import needs the `cd`: run it from the project root and the source tree
shadows the installed wheel on `sys.path`, so a wheel missing a module imports
cleanly from inside the repo and raises `ModuleNotFoundError` from outside it.

```sh
cd "$(mktemp -d)" && uv run --no-project --with /abs/path/dist/pkg-1.0-py3-none-any.whl \
  python -c "import pkg, importlib.metadata as m; print(m.version('pkg')); \
  [ep.load() for ep in m.distribution('pkg').entry_points]"
```

- **A successful `uv build` is not evidence the sdist is complete**: an sdist holding only `README.md`, `pyproject.toml` and `PKG-INFO` builds "successfully" at exit 0, because default `uv build` prints "Building wheel from source distribution" while the fast path builds from the source tree. `uv build --force-pep517` builds from the sdist, emits a wheel containing only `dist-info`, and still exits 0. Only `check-wheel-contents` catches it (`W007`, `W008`).
- **There is no Python analogue of attw**, and no committed-report analogue of api-extractor's `.api.md`: `griffe dump` is deterministic but carries `lineno`/`endlineno`/`filepath` keys holding absolute paths, so a committed report is bespoke to one checkout. The normaliser that strips them, and the rest of griffe's CI placement, live in `references/contract-gates.md`.
- **`griffe check` is blind to every annotation change** (`str` to `int` on a parameter exits 0), so it gates structure while `--verifytypes` gates the type half; its default `-a` is "latest tag", which tracebacks with exit 1 on a shallow CI clone - the same exit code as a real breakage - so `fetch-depth: 0` is required.
- `stubtest` is opt-in and only for a separate `-stubs` distribution: with the runtime package shipping inline `py.typed` types and no stubs installed it compares the package against its own types and prints `Success`. `abi3audit` is a no-op on pure wheels and cibuildwheel 4.0 already runs it; `pyroma` scores taste and exits **2**; `uv publish --dry-run` prints an authentication error and exits 0.

## Gate integrity

Every gate in this file can fail open. Assume none is armed until a canary proves
it. One line per class:

- **Ruff preview no-op**: `preview = false` plus a preview code warns and passes; a preview *family* selected by prefix gates zero rules and says nothing.
- **`ruff check --config <file>`** disables hierarchical discovery, so a nested layer config stops firing; the `<KEY>=<VALUE>` form does not.
- **Two negated `per-file-ignores` entries for one rule cancel**, because every file matches one of them; use a single brace glob.
- **A typo'd negated glob** (`"!srcc/domain/**"`) disables the rule everywhere, and a typo'd `banned-api` key is a no-op: the ban does not exist.
- **An import-linter wildcard matching nothing** is reported `KEPT`, while a misspelled exact module name errors loudly.
- **A wildcard `ignore_imports` edge** errors while it matches nothing, then absorbs every future violation once it matches one.
- **`exhaustive_ignores` with no `exhaustive = true`** skips the exhaustiveness check and reports `KEPT`; the containerless case is loud, a hard config error.
- **pyrefly with no config** exits 0, and its `warn` severity neither affects the exit code nor prints the warning.
- **`pyrightconfig.json` outranks `pyproject.toml`** with no message; exit 3 on a config error still prints diagnostics first, so a step grepping for "0 errors" reads it as a pass.
- **A file-level `# pyright: reportX=false`** silences that rule for the whole module and no config key disables the mechanism; only a grep sees it.
- **Upstream pyright on a `[tool.basedpyright]` table** reads no rules at all.
- **`validate-pyproject` without the `[all]` extra** warns on stderr and exits 0.
- **`stubtest` without the stubs installed** prints `Success`; **`abi3audit` on a pure wheel** finds nothing auditable and exits 0.
- **ast-grep `severity: warning`** exits 0 where `severity: error` exits 1, and a leading `./` in a `files:` glob matches nothing.
- **Opengrep without `--error`** exits 0 with findings; rule-level `severity: ERROR` does not change that.
- **`licensecheck` without `--zero`** prints the incompatible row and exits 0.
- **`deadcode` always exits 0**; **vulture exits 3**, not 1.
- **`uv sync --frozen` is not a drift gate**; `--locked` is.
- **A stray `pytest.ini` in a subdirectory** silences every setting in the root `pyproject.toml`, and `-q` hides the only on-screen tell.
- **`filterwarnings` ordering**: a broad `ignore::` entry after `"error"` guts the category, and pytest-socket under `["error"]` raises a `UserWarning` from the exception constructor instead of `SocketBlockedError`.

Feed a gate a known violation and assert the non-zero exit, then feed the same
violation at an exempt path and assert zero.

## Maintenance posture

Ruff, uv and ty are Astral-backed; basedpyright merges upstream Microsoft
pyright, so its analysis engine is corporate-maintained even though the fork
layer is one person; pyrefly is Meta's. Everything else here is bus-factor one.
That sets the review cadence, not a veto: pin exact versions, prefer a tool that
is already a dependency of one you have (grimp over a second architecture-test
library), and prefer a loud failure mode over a silent pass.
