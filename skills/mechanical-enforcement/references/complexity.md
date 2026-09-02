# Mechanical Enforcement - Complexity and duplication

Cross-stack: what each metric is worth as evidence, the numbers and where they
come from, which metric to run where, duplication gates, and Go settings.
Ratchet vehicles live in `references/ratcheting.md`. Per-stack wiring lives with
its stack - `references/typescript.md`, `references/python.md`,
`references/rust.md`. Routed from the picks table and rules-catalogue index in
`SKILL.md`.

- [What the evidence supports](#what-the-evidence-supports)
- [The numbers](#the-numbers)
- [One metric per concern](#one-metric-per-concern)
- [Every complexity rule is off by default](#every-complexity-rule-is-off-by-default)
- [Duplication](#duplication)
- [Go](#go)
- [Ratcheting a complexity gate](#ratcheting-a-complexity-gate)
- [Report-only, and tools that cannot gate](#report-only-and-tools-that-cannot-gate)

## What the evidence supports

**Gate size, nesting and parameter count. Treat branch counts as a review
trigger rather than a defect model. Never gate on a composite index.**

No complexity threshold has an established defect-rate inflection point. Claims
of one - "defects climb sharply past ~24" and its variants - trace back to no
primary source; Microsoft's 25 is a tool default with no defect study behind it.
The numbers below are conventions with named origins, not empirical optima, and
they are stated that way on purpose.

*Cyclomatic complexity* is contested at exactly the point that matters. Jay et
al. (JSEA 2009) fitted repeated-median regressions over 1.2M SourceForge C, C++
and Java files and concluded CC "has no explanatory power of its own" - but that
90%-of-variance figure is log(LOC) against log(CC), and their own
Breusch-Pagan test rejected homoscedasticity in every sample. Landman et al.
(ICSME 2014 / JSEP 2016), over 17.6M Java methods and 6.3M C functions, found
only R² 0.40 (Java) and 0.44 (C) at *method* level and explicitly declined to
call CC redundant with SLOC; the higher figures quoted from that paper (0.73 /
0.70) are its sum-of-subroutine-bodies rows, and the authors read those as
measuring system size rather than subroutine complexity. So: at file level a
branch count is largely a size metric, and at function level it carries some
independent signal but predicts nothing in particular. Cap it loosely and treat
a hit as a prompt to look.

*Cognitive complexity* (Campbell / SonarSource S3776) is the best-evidenced
metric here, which is a low bar. Muñoz Barón, Wyrich & Wagner (ESEM 2020)
meta-analysed 10 studies and 427 snippets: r = 0.54 with comprehension **time**
and -0.29 with subjective ratings, but **-0.13 with comprehension correctness
on a confidence interval that crosses zero** (I² = 79%), and 0.00 against
physiological measures from a single study. The honest reading is that it tracks
how long code takes to read, and shows no evidence of tracking whether people
get it right. It earns its slot because it weights nesting, which a branch count
does not - a flat 12-arm dispatch and a 4-deep nest score alike under McCabe.

*Nesting depth* is the cheap, underused proxy. It costs one integer, the fix is
almost always an early return, and it catches the shape a branch count blurs.

*Duplication* matters through a specific mechanism, not as a sin. Juergens et
al. (ICSE 2009) rated ~1800 clone groups with the systems' own developers: 52%
contained inconsistencies, 28% of those were unintentional, and 107 confirmed
faults followed. The paper is explicit that clones do not directly cause faults;
the mechanism is incomplete propagation of a change. That is why the gate
belongs on *new* clones rather than on a global percentage.

*Churn × complexity hotspots* have real but vendor-authored support: Tornhill &
Borg (TechDebt 2022, co-located with ICSE) report up to 15× more defects and
124% longer time-in-development in "alert" files across 39 proprietary
codebases. Code Health itself is proprietary and unpublished, the sample is the
vendor's own customers, and the authors flag the causal direction as unresolved.
The hotspot *ranking* has no peer-reviewed evaluation at all. Useful for
choosing what to refactor first; not a gate.

*Maintainability index* is not defensible as a gate. Fitted by Oman &
Hagemeister (ICSM 1992) against engineer ratings of a handful of small HP C and
Pascal programs, never recalibrated, and built from inputs that are all size
proxies. Tools disagree on the formula - Visual Studio drops the comment term
and rescales onto 0-100 with different thresholds - so the same code scores
differently depending on who measures it. Failing a build because a function
scored 17 is meaningless, and the number names no fix.

## The numbers

One number per concern, held across stacks where the units allow. Where a
stack's own default is defensible, adopt it rather than inventing one.

| Concern | Number | Where it comes from |
|---|---|---|
| Cyclomatic complexity, per function | **15** (10 greenfield) | NIST SP 500-235 §2.5 verbatim: "The original limit of 10 as proposed by McCabe has significant supporting evidence, but limits as high as 15 have been used successfully as well." Read the next sentence too - NIST conditions anything over 10 on experienced staff, formal design, code walkthroughs and a comprehensive test plan. |
| Cognitive complexity, per function | **15** | SonarSource's own S3776 default, and independently the default of Biome, eslint-plugin-sonarjs and complexipy - so one number spans TS and Python. Ultracite's 20 is an adoption ceiling, not a recommendation. |
| Nesting depth | **4** | The oxlint/ESLint `max-depth` default and von Zitzewitz's number. Ruff's `PLR1702` tightened from 5. Clippy counts *blocks* with the fn body as level 1, so its 5 is this 4. |
| File length | **300** new / **800** ratchet ceiling | 300 is the oxlint and Biome default. 800 (von Zitzewitz) is where a file is *already* a problem - a ceiling to ratchet toward, not a trigger. |
| Function length | each tool's default: **50** lines (TS), **50** statements (Python), **60** lines / **40** statements (Go), **100** lines (Rust) | Convention, not an inflection point: the mechanism is a reviewer's working memory and the integer is folklore. Adopting the tool default is honest and costs no argument. |
| Parameters | **4** (TS/JS), **5** (Python `max-args`), **3** (Python positional), **7** (Rust) | 4 matches Biome's `useMaxParams`; the oxlint/ESLint default of 3 fires on ordinary render props. Python's positional-3 targets the actual defect - unlabelled call sites - while keyword args stay free. Rust's 7 is clippy's default and already live under `-D warnings`. |
| Nested callbacks | **3** | The oxlint/ESLint default of 10 is unreachable in async/await code, so it gates nothing. Biome's nursery equivalent picks 5 - use that if 3 is noisy. |
| Nested call expressions | **3** | eslint-plugin-unicorn's default. `a(b(c(d(x))))` has no named intermediates and no readable stack position. |
| Operators in one condition | **3** | sonarjs `expression-complexity` default. The sub-statement gap that branch counts and depth caps both miss. |
| Duplicate block, minimum | **50 tokens / 5 lines** | jscpd's defaults. Below that is noise, which is also why sonarjs's schema refuses a line threshold under 3. |
| Duplication percentage | **3%**, as a ratchet | Arbitrary as an absolute. Set it just under today's figure and lower it. The honest gate is "no new clone above N tokens", which needs jscpd's baseline. |

## One metric per concern

Two overlapping metrics double the suppression burden and produce two numbers
arguing about one function:

- **Cognitive complexity replaces a tightened cyclomatic cap.** Where both exist
  (TS via sonarjs, Python via complexipy, Go via gocognit), prefer cognitive and
  leave the cyclomatic rule at a loose backstop.
- **Statement count is a strict subset of function length.** Keep the line gate.
- **A nesting-weighted score is not a depth.** Go's `nestif` and clippy's
  `cognitive_complexity` are scores; `max-depth`, ruff's `PLR1702` and clippy's
  `excessive_nesting` are counts. Do not harmonise the integers.
- **Dead code before size.** A size gate firing on a file that is 40%
  unreachable exports suggests splitting where the fix is deleting.

## Every complexity rule is off by default

Across all four stacks the failure mode is the same: the rule is *configured*,
appears to gate, and checks nothing. It is worth asserting each gate fires on a
known-bad fixture rather than trusting a green run.

| Stack | The trap | Verified |
|---|---|---|
| TypeScript | oxlint's metric rules sit in `pedantic` / `style` / `restriction`, so `-D warnings` never reaches them. Ultracite explicitly switches five of the eight **off**. | oxlint 1.77.0: a 5-deep, 5-param function reports nothing on a bare run |
| TypeScript | Biome's seven cap rules all default below `error` (five `information`, two `warning`), and Biome exits non-zero only on error-level diagnostics. | Biome 2.5.11 rule declarations |
| Python | Selecting a preview rule with `preview = false` prints `warning: Selection PLR1702 has no effect` and then `All checks passed!`. | ruff 0.16.2 |
| Rust | A `clippy.toml` key sets a threshold; it does not enable a lint. `pedantic` and `restriction` lints stay silent with no warning that the key did nothing. | clippy 0.1.97 |
| Go | None of the nine complexity linters is in the `standard` set, and `gocyclo` / `gocognit` default to 30 - loose enough to never fire. | golangci-lint v2.13.2 |

## Duplication

The bug class is copy-paste divergence, and it is the shape agent-written code
fails in: a second helper written instead of the first being found.

**jscpd** is the cross-stack gate: Rabin-Karp over tokens, which survives
reformatting and renaming better than line comparison, across 223 formats, so
one gate covers a polyglot repo.

```bash
jscpd . --min-tokens 50 --min-lines 5 --threshold 3 \
        --ignore "**/migrations/**,**/generated/**,**/*.test.*"
```

`--threshold` alone owns the exit code: since the v5 Rust rewrite the binary
auto-injects the `threshold` reporter whenever the flag is set, prints
`ERROR: jscpd found too many duplicates`, and exits 1. Three traps:

- **`--exit-code` is not a percentage gate.** It fails on *any* clone at all,
  independent of `--threshold`, and only after the threshold check has passed.
  Never combine the two. It also takes an optional value, so `--exit-code .`
  swallows the path argument.
- **The comparison is strictly greater**, so `--threshold 5` passes at exactly
  5.0% - the published docs say `>=` and contradict the source. `--threshold 0`
  is the zero-tolerance gate.
- **There is no `linux-arm64-musl` artifact.** The npm package is a Node shim
  that resolves one of six platform binaries; on Alpine/arm64 it prints
  `Unsupported platform` and exits 1, which a naive gate reads as "duplication
  found". Use a glibc image, `cargo install jscpd`, or Nix.

Ignore generated clients, migrations, fixtures and vendored trees **before**
setting a percentage, or the number means nothing.

**In-linter halves** catch what jscpd misses inside a file:
`sonarjs/no-identical-functions` (TS) and `dupl` (Go). Both have real limits -
sonarjs counts **lines** and refuses a threshold below 3, and `dupl` compares
only within one package. Short duplicated helpers, the commonest
agent-generated shape, are caught by neither those nor jscpd's 5-line floor.
That gap is unclosed; nothing found closes it.

**similarity-ts / -py / -rs** find structurally-equivalent functions under
different names, which token hashing cannot. Advisory only - they gate only
behind an explicit flag, and are pre-1.0 with single maintainers. Run them as an
on-demand agent self-audit, not a hook.

## Go

No complexity linter is in golangci-lint's `standard` set (errcheck, govet,
ineffassign, staticcheck, unused), so each must be enumerated - never
`default: all`. Drop-in: `references/golangci-complexity.yml`.

| Setting | Default | Recommended | Notes |
|---|---|---|---|
| `cyclop.max-complexity` | 10 | 15 | Prefer `cyclop` over `gocyclo`. They are **not** identical counters: gocyclo skips `default:` clauses and cyclop counts them, so cyclop scores one higher per `default:`. cyclop also adds a package average. |
| `cyclop.package-average` | 0.0 (off) | 10.0, advisory | Catches what a per-function cap cannot see - a package where every function sits just under the cap. Weak as a gate: an average improves when you add trivial functions. |
| `gocognit.min-complexity` | 30 | 15 | Real Campbell cognitive complexity, nesting-weighted. The reference config's own comment concedes "we recommend 10-20", so the default gates nothing. |
| `funlen.lines` / `.statements` / `.ignore-comments` | 60 / 40 / **true** | same, set explicitly | `ignore-comments` flipped to `true` in v2. Migrating a v1 config that omitted it silently loosens the gate. A negative value disables that half. |
| `nestif.min-complexity` | 5 | 4 | A nesting-**weighted** score over `if` statements, not a depth - not the same unit as `max-depth: 4`. It also reports at `>=` while the other four are strictly greater, so it is off by one against them. |
| `dupl.threshold` | 150 tokens | 150 | Compares files **within one package only**; cross-package duplication is invisible to it. The classic false-positive generator on table-driven tests - exclude `_test.go` explicitly, it has no built-in test skip. |
| `gochecknoglobals` | enabled, **no settings exist** | pure-domain packages only | The whitelist is hard-coded and unconfigurable: consts, `_`, the bare name `version`, `err*`/`Err*` identifiers implementing `error`, `//go:embed` vars, and `regexp.MustCompile` values. A package logger, a `sync.Once` or a metrics registry all report, so exclude those packages by path. |
| `maintidx.under` | 20 | leave off | Maintainability index - see the report-only table. At the default it almost never fires; raising it makes it noisy fast because the `16.2*ln(LOC)` term dominates. |

Four v2 migration traps:

- `linters-settings` became `linters.settings`, and v2 **rejects** the v1 key
  rather than ignoring it - run `golangci-lint migrate`.
- `cyclop.skip-tests` is not a v2 setting - golangci-lint hard-sets it false,
  with the comment "Should be managed with `linters.exclusions.rules`". A
  `skip-tests: true` entry is silently dropped by `run`.
- **`golangci-lint run` does not reject unknown config keys** - viper drops them
  without error. Only `golangci-lint config verify` catches a typo, so run it in
  CI or a misspelled threshold silently gates nothing.
- `linters.default: standard` plus `enable:` is additive. Use `default: none`
  if you want only the complexity gate.

Enable **`nolintlint`** alongside these (`require-explanation`,
`require-specific`, `allow-unused` all default false) or `//nolint:cyclop`
becomes an unexplained escape hatch that quietly guts the gate. Note
golangci-lint's own bundled JSON schema documents `allow-unused` as defaulting
to `true`; the Go source and reference config both say `false`. Trust the
source.

## Ratcheting a complexity gate

The vehicle table and the complexity-specific notes (the all-oxc stack, ruff,
complexipy, jscpd, Go) live in `references/ratcheting.md`.

## Report-only, and tools that cannot gate

Useful as reports. Wiring any of them to an exit code is a mistake:

| Tool / metric | Why it cannot gate |
|---|---|
| Maintainability index (`radon mi`, Go `maintidx`) | Non-independent inputs, 1992 constants, tool-dependent values, and unactionable output - "your index is 17" names no fix. The three primitives underneath it do. |
| `scc`'s COMPLEXITY column | A keyword count, by the author's own description an approximation. File-level only, roughly proportional to file size, not comparable across languages, and there is no threshold flag. |
| `tokei` / `cloc` / `gocloc` | Counters with no threshold option and no non-zero exit. |
| `qlty smells` / `qlty metrics` | Always exit 0 by construction. Its documented default thresholds are worth mining; the tool is not a gate. `qlty check` is BUSL-1.1 and downloads plugins on first run, duplicating the per-stack picks with a second config surface outside mise's quarantine. |
| `symilar` (pylint) | Ends in an unconditional `sys.exit(0)`. Use `pylint --disable=all --enable=duplicate-code`. |
| `similarity-ts` / `-py` / `-rs`, `cargo dupes` | Exit 0 unless an explicit flag is passed; pre-1.0, single maintainer. |
| Codebase-average complexity (`xenon --max-average`) | Improves when you add trivial functions. |
| Duplication percentage, un-ratcheted | Meaningless as an absolute until generated and fixture trees are excluded. |

**Metric rules are not expressible in a pattern engine.** Opengrep/Semgrep's
`metavariable-comparison` compares a bound numeric literal; there is no counting
or aggregation across matches, and ast-grep's `nthChild` filters by index, not
count. Both *can* express a fixed nesting depth - N literal nested levels is a
shape, not a count - but that is per-language and O(N) to write. Use the linter
rule for depth and keep Opengrep for the taint and dataflow rules it is picked
for in `references/architecture-boundaries.md`.

**`lizard`** is the fallback for languages nothing else covers (Swift, Kotlin,
Lua, Solidity, Zig and 20 more). It gates out of the box - `-C 15 -a 5`, any
warning exits 1 - and its `-End -N 4` extension is the only cross-language
nesting-depth gate found. Its `-i N` tolerance is not a per-site baseline (see
`references/ratcheting.md`). Pure
Python and single-threaded by default (`-t $(nproc)`), so glob it to the
languages nothing else covers, or run it at pre-push.
