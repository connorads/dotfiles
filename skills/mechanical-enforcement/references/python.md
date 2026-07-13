# Mechanical Enforcement — Python

Per-stack rules for Python: Ruff format + lint, type checking, dead code, and
import boundaries. Routed from the picks table and rules-catalogue index in
`SKILL.md`.

- [Ruff format + lint](#ruff-format--lint)
- [Type checking](#type-checking)
- [Dead code (Vulture)](#dead-code-vulture)
- [Boundaries (import-linter)](#boundaries-import-linter)

## Ruff format + lint

Ruff is the default Python formatter and linter. It replaces Black, isort,
Flake8, pyupgrade, and most Pylint-style low-level checks. Use an explicit,
stable rule set in shared templates; do not use `ALL` as the baseline because
new Ruff releases can add rules and turn upgrades into behaviour changes. See
`references/python-ruff.toml` for a drop-in `pyproject.toml` snippet.

Ruff 0.15 (2026) ships a one-time style-guide reformat and block-level
suppression comments (`# ruff: disable[RULE]` / `# ruff: enable[RULE]`) — prefer
those over file-wide `noqa`, and let the reformat land deliberately under the
release-age quarantine rather than as surprise churn on upgrade.

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Stable baseline checks | `select = ["E", "F", "UP", "B", "SIM", "I", "RUF"]` | Syntax/style drift, Pyflakes bugs, stale Python syntax, common bug patterns, import disorder | Add noisier families per project once clean. |
| Formatter owns wrapping | Ruff format + ignore `E501` | Formatter/linter disagreement on line length | Re-enable `E501` only when the team wants hard line-length gates. |
| Safe fixes only by default | `ruff check --fix --show-fixes`; no `--unsafe-fixes` in hooks/CI | Mechanical rewrites changing semantics | Run unsafe fixes only as reviewed one-offs. |
| Tests get test-shaped ignores | per-file ignores for `tests/**` | Lints fighting idiomatic tests | Commonly relax `S101`, `ARG`, `FBT`, `PLR2004`, `D`, `ANN`. |
| Generated/migration files stay explicit | `exclude` for generated trees; per-file ignores for migrations | Generated/framework output obscuring real failures | Ignore whole generated trees; relax migrations narrowly. |

Optional high-signal rule families once a project is ready: `C4`, `PIE`, `RET`,
`PTH`, `LOG`/`G`, `T10`, `T20`, `PT`, `S`, `ARG`, `TC`, `PERF`. Treat `D`,
`ANN`, `PL`, `TRY`, `FBT`, `TD`, and `FIX` as policy-heavy; useful in strict
projects, noisy as defaults.

## Type checking

Use basedpyright as the default blocking type gate. Its `recommended` mode is
the best shared default: broad diagnostics, fail-on-warnings behaviour, and a
baseline workflow for existing projects. The fast Rust newcomers are catching
up — pyrefly is production (1.x), ty still beta — but basedpyright stays the gate
on maturity, conformance, and its MIT licence. See
`references/python-typecheck.toml`.

| Tool | Default use | Notes |
|---|---|---|
| basedpyright | Primary gate with `typeCheckingMode = "recommended"` | Prefer `[tool.basedpyright]` in `pyproject.toml`; use `--writebaseline` only during adoption, never in CI. |
| basedpyright `all` | Greenfield or deliberately strict projects | Higher friction; enable only once the codebase wants that contract. |
| pyright | Compatibility fallback | Use `pyright --warnings` so warnings fail CI. |
| pyrefly | Fast secondary / migration aid (Rust) | Meta's checker reached stable 1.x (~92% conformance, production at Instagram/PyTorch). Strong fast pre-filter and mypy/pyright-config migration path, but it doesn't follow strict semver — a bump can add errors — so keep basedpyright as the authoritative gate. |
| ty | Watch (beta, 0.0.x) | Astral's checker; fastest of the field and best uv/ruff fit, but diagnostics are explicitly unstable and conformance trails the others. Advisory only — re-evaluate at 1.0. |

Suppressions must be narrow and rule-coded: `# pyright: ignore[reportX]`,
`# pyrefly: ignore[rule]`, `# ty: ignore[rule-name]`, or
`# type: ignore[ty:rule-name]`. Avoid bare `# type: ignore`; keep unused-ignore
diagnostics enabled so suppressions expire.

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
with `lint-imports` (non-zero exit). Two properties make it the pick — it gates
transitive import *chains* natively (an A→B→C path breaks a forbidden A→C
contract), and it includes `if TYPE_CHECKING:` imports by default, so type-only
coupling can't launder a boundary. Its grimp graph engine is Rust-accelerated,
so speed is not a differentiator for the newer rivals. Mature but
single-maintainer. See `references/python-import-linter.toml`.

**tach** (Rust) is opt-in for the two jobs import-linter has no primitive for:
`strict` public-interface enforcement (consumers may only import a module's
declared interface — blocks deep imports of internals) and guided incremental
adoption on legacy codebases (`tach mod` / `tach sync`). Know its caveats: it
checks direct declared edges only — it does **not** gate transitive chains; and
`tach sync` auto-allowlists existing imports, so unreviewed output bakes
accidental coupling in as permanently-allowed edges. It was abandoned once
(its company pivoted away from dev tools) and revived under a solo community
maintainer — bus factor ~1 with a prior death, so discount its star lead.
If ArchUnit-style tests inside pytest are wanted instead, prefer PyTestArch
over pytest-archon.

The cross-stack boundary philosophy (why boundaries are linter rules, the
transitive-graph approach, greppable invariants, purity) lives in
`references/architecture-boundaries.md`.
