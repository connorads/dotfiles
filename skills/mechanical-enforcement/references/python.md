# Mechanical Enforcement - Python

Per-stack rules for Python: Ruff format + lint, type checking, dead code, and
import boundaries. Routed from the picks table and rules-catalogue index in
`SKILL.md`.

- [Ruff format + lint](#ruff-format--lint)
- [Type checking](#type-checking)
- [Complexity](#complexity)
- [Dead code (Vulture)](#dead-code-vulture)
- [Boundaries (import-linter)](#boundaries-import-linter)

## Ruff format + lint

Ruff is the default Python formatter and linter. It replaces Black, isort,
Flake8, pyupgrade, and most Pylint-style low-level checks. Use Ruff's curated
defaults plus deliberate additions through `extend-select`; `select` replaces
the defaults entirely. Pin one minor release with `required-version`: Ruff's
[`versioning policy`](https://docs.astral.sh/ruff/versioning/) reserves stable
default-set changes for minor releases, so a minor bump remains the explicit
review point. Do not use `ALL` as a baseline.
See `references/python-ruff.toml` for a drop-in `pyproject.toml` snippet.

Ruff 0.15 (2026) shipped a one-time style-guide reformat and block-level
suppression comments (`# ruff: disable[RULE]` / `# ruff: enable[RULE]`);
Ruff 0.16 (2026-07) adds the line form `# ruff: ignore[RULE]`, Markdown
code-block formatting, and grows the
[`default rule set`](https://docs.astral.sh/ruff/default-rules/) from 59 to 413
rules.
Prefer reason-bearing scoped suppression comments over file-wide `noqa`, and
let minor upgrades and reformats land deliberately under the release-age
quarantine rather than as surprise churn. Markdown code-block formatting is
opt-in when another formatter already owns Markdown files.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Stable baseline checks | Ruff defaults + `extend-select = ["E", "F", "UP", "B", "SIM", "I", "RUF"]`, with one pinned minor | Curated cross-family correctness checks plus the established full-family coverage | `select` replaces the defaults; use it only when that is deliberate. Add noisier families per project once clean. |
| Formatter owns wrapping | Ruff format + ignore `E501` | Formatter/linter disagreement on line length | Re-enable `E501` only when the team wants hard line-length gates. |
| Safe fixes only by default | `ruff check --fix --show-fixes`; no `--unsafe-fixes` in hooks/CI | Mechanical rewrites changing semantics | Run unsafe fixes only as reviewed one-offs. |
| Tests get test-shaped ignores | per-file ignores for `tests/**` | Lints fighting idiomatic tests | Commonly relax `S101`, `ARG`, `FBT`, `PLR2004`, `D`, `ANN`. |
| Generated/migration files stay explicit | `exclude` for generated trees; per-file ignores for migrations | Generated/framework output obscuring real failures | Ignore whole generated trees; relax migrations narrowly. |

Use `# ruff: ignore[CODE] reason` for one logical line and paired
`# ruff: disable[CODE]` / `# ruff: enable[CODE]` comments for a range. For bulk
adoption, `ruff check --select CODE --add-ignore` records scoped debt; keep
`RUF100` enabled so stale suppressions expire.

Optional high-signal rule families once a project is ready: `C4`, `PIE`, `RET`,
`PTH`, `LOG`/`G`, `T10`, `T20`, `PT`, `S`, `ARG`, `TC`, `PERF`. Treat `D`,
`ANN`, `PL`, `TRY`, `FBT`, `TD`, and `FIX` as policy-heavy; useful in strict
projects, noisy as defaults.

## Type checking

Use basedpyright as the default blocking type gate. Its `recommended` mode is
the best shared default: broad diagnostics, fail-on-warnings behaviour, and a
baseline workflow for existing projects. The fast Rust newcomers are catching
up - pyrefly is production (1.x), ty still beta - but basedpyright stays the gate
on maturity, conformance, and its MIT licence. See
`references/python-typecheck.toml`.

| Tool | Default use | Notes |
|---|---|---|
| basedpyright | Primary gate with `typeCheckingMode = "recommended"` | Prefer `[tool.basedpyright]` in `pyproject.toml`; use `--writebaseline` only during adoption, never in CI. |
| basedpyright `all` | Greenfield or deliberately strict projects | Higher friction; enable only once the codebase wants that contract. |
| pyright | Compatibility fallback | Use `pyright --warnings` so warnings fail CI. |
| pyrefly | Fast secondary / migration aid (Rust) | Meta's checker reached stable 1.x (~92% conformance, production at Instagram/PyTorch). Strong fast pre-filter and mypy/pyright-config migration path, but it doesn't follow strict semver - a bump can add errors - so keep basedpyright as the authoritative gate. |
| ty | Watch (beta, 0.0.x) | Astral's checker; fastest of the field and best uv/ruff fit, but diagnostics are explicitly unstable and conformance trails the others. Advisory only - re-evaluate at 1.0. |

Suppressions must be narrow and rule-coded: `# pyright: ignore[reportX]`,
`# pyrefly: ignore[rule]`, `# ty: ignore[rule-name]`, or
`# type: ignore[ty:rule-name]`. Avoid bare `# type: ignore`; keep unused-ignore
diagnostics enabled so suppressions expire.

## Complexity

The cross-stack argument and the numbers live in `references/complexity.md`;
the config block is `references/python-ruff.toml`. This is the rule map.

Ruff's 413-rule default set contains **no** complexity rule, so every code below
must be named explicitly - and five of them are preview-only.

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
| Cognitive complexity | `complexipy --max-complexity-allowed 15 <paths>` | The read-difficulty half: a flat 12-branch dispatch and a 4-deep nest score alike under C901 | Ruff has no cognitive-complexity rule and will not get one until rule categorisation is settled (astral-sh/ruff#2418, open since 2023, `needs-decision`). complexipy implements the real nesting-weighted Campbell metric, defaults to 15, exits 1, and ships the only Python complexity baseline that exists. Install `pipx:complexipy`. Run it **instead of** tightening C901. |
| Duplicate code | `pylint --disable=all --enable=duplicate-code` | Copy-paste divergence: the second copy never gets the bug fix | Ruff does not implement `R0801` and structurally cannot - it is per-file and parallel, while R0801 is a whole-project cross-file pass. Raise `min-similarity-lines` to 8; the default 4 floods on imports and boilerplate. **Do not use the standalone `symilar` binary as a gate** - it ends in an unconditional `sys.exit(0)`, so it reports and can never fail. |
| File length | `radon raw -s`, or a `wc -l` step | A Python tree drifting while TS and Rust gate file size | pylint's `C0302` has no Ruff equivalent and is **declined upstream** as incompatible with the formatter, so this fallback is permanent rather than a stopgap. |

**Preview rules need `explicit-preview-rules`, not blanket preview.** Selecting
`PLR1702` with preview off prints
`warning: Selection PLR1702 has no effect because preview is not enabled` and
then `All checks passed!` - the rule is in the config, appears to gate, and
checks nothing. Set `preview = true` **and** `explicit-preview-rules = true`,
then name every preview rule by exact code: under that pairing a bare `PLR`
prefix enables none of them, which preserves what `preview = false` was buying
(no surprise preview rules on a minor bump) while letting the five complexity
rules gate. Verified on ruff 0.16.2.

**complexipy resolves its config against the invocation directory, and does not
walk up.** Run it from a subdirectory and it silently uses defaults - threshold
15 rather than your `[tool.complexipy]` - and finds no
`complexipy-snapshot.json`, which quietly disables grandfathering while the
plain threshold check still fires. Pin the working directory in the hook step.
Two more: `--diff <ref>` is a threshold gate, not a no-regressions gate (a
function going 3 → 4 under a limit of 15 passes), and the 6.0.0 scoring
conformance pass raised most scores, so a threshold tuned on 5.x will start
failing. The v7 CLI removed `--output-json` / `--output-csv` / `--ratchet`;
prefer the long `--max-complexity-allowed` over `-mx`, which the in-progress
native CLI drops.

**Ruff's C901 counts fewer constructs than radon.** Ruff scores
`if a and b and c` as 2, having no per-boolean-operator increment; radon adds
one per extra operand and also counts comprehensions and `assert` higher
(`radon cc --no-assert` closes the last one). A threshold ported from radon is
therefore materially stricter in Ruff. Pick one tool and tune the number in it.

## Dead code (Vulture)

Use Vulture for whole-project dead-code audits, not as a Ruff replacement. Ruff
/ Pyflakes already cover unused imports and local variables; Vulture adds
broader unused functions, classes, attributes, properties, and unreachable code.
See `references/python-vulture.toml`.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Whole-repo analysis | Run `vulture` from repo root; do not pass only changed files | False confidence from incomplete reachability | Include `src`, `tests`, scripts, and whitelist files. |
| Conservative gate | `min_confidence = 100` | Dynamic Python false positives blocking commits | Use lower confidence only for manual cleanup reports. |
| Whitelist intentional dynamic use | `vulture_whitelist.py` checked into the repo | Broad excludes hiding real dead code | Prefer whitelists over `ignore_names` / `ignore_decorators`; exclude only generated/vendor/build trees. |

## Boundaries (import-linter)

[import-linter](https://import-linter.readthedocs.io/) is the default: declare
`layers` / `forbidden` / `independence` contracts in `pyproject.toml` and gate
with `lint-imports` (non-zero exit). Two properties make it the pick - it gates
transitive import *chains* natively (an A→B→C path breaks a forbidden A→C
contract), and it includes `if TYPE_CHECKING:` imports by default, so type-only
coupling can't launder a boundary. Its grimp graph engine is Rust-accelerated,
so speed is not a differentiator for the newer rivals. Mature but
single-maintainer. See `references/python-import-linter.toml`.

**tach** (Rust) is opt-in for the two jobs import-linter has no primitive for:
`strict` public-interface enforcement (consumers may only import a module's
declared interface - blocks deep imports of internals) and guided incremental
adoption on legacy codebases (`tach mod` / `tach sync`). Know its caveats: it
checks direct declared edges only - it does **not** gate transitive chains; and
`tach sync` auto-allowlists existing imports, so unreviewed output bakes
accidental coupling in as permanently-allowed edges. It was abandoned once
(its company pivoted away from dev tools) and revived under a solo community
maintainer - bus factor ~1 with a prior death, so discount its star lead.
If ArchUnit-style tests inside pytest are wanted instead, prefer PyTestArch
over pytest-archon.

The cross-stack boundary philosophy (why boundaries are linter rules, the
transitive-graph approach, greppable invariants, purity) lives in
`references/architecture-boundaries.md`.
